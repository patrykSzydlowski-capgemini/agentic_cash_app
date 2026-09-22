import cds from '@sap/cds'
import type { Request } from '@sap/cds'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import axios from 'axios'
import type { ingestAgentMatch, processPaymentDocument } from '../@cds-models/CashSyncService/index.js'
import { extractPayment } from './agents/extraction-agent.js'
import type { ExtractedPayment } from './agents/extraction-agent.js'
import { proposeMatches } from './agents/matching-agent.js'
import type { ProposedMatchCandidate } from './agents/matching-agent.js'
import type { OpenItem } from './s4/open-items-client.js'
import { getOpenItems as getLiveOpenItems } from './s4/open-items-client.js'
import { postClearing, type SapMessage } from './s4/clearing-client.js'

// Below this extractionConfidence the Matching Agent is skipped entirely
// rather than run on shaky data, and the payment goes straight to needsReview.
// 0.6 mirrors the reference ts-agentic-poc policy; revisit with usage data.
export const LOW_CONFIDENCE_THRESHOLD = 0.6

const { INSERT, UPDATE, SELECT, UPSERT } = cds.ql
const LOG = cds.log('cash-service')
type ProcessPaymentDocumentPayload = Parameters<typeof processPaymentDocument>[0]
type IngestAgentMatchPayload = Parameters<typeof ingestAgentMatch>[0]

// Bundled remittance advice used by the UI's sample-validation button.
const SAMPLE_PDF_PATH = join('test-fixtures', 'remittance-samples', 'multi-invoice-remittance.pdf')

interface AgentResponse {
    confidence: number
    review_required: boolean
    reason: string
}

interface PipelineResult {
    payment: ExtractedPayment
    candidates: ProposedMatchCandidate[]
    openItems: OpenItem[]
}

export default class CashSyncServiceImpl extends cds.ApplicationService {
    async init() {
        const { MatchResult: DbMatchResult, OpenItem: DbOpenItem } = cds.entities('poc.cash')

        // 1. Manual approval from the UI
        this.on('triggerAIAgent', 'MatchResult', async (req: Request) => {
            const first = req.params[0] as { match_id?: string } | string | undefined
            const matchId = typeof first === 'object' ? (first?.match_id ?? first) : first

            await UPDATE.entity(DbMatchResult)
                .set({
                    match_status: 'MATCHED',
                    action_required: false,
                    review_status: 'APPROVED',
                    review_reason: 'Manually approved by operator'
                })
                .where({ match_id: matchId })

            req.notify(`Agent successfully processed record ${matchId}`)
        })

        // 2. Webhook / Action for external match ingestion
        this.on('ingestAgentMatch', async (req: Request) => {
            const { match_id, open_item_id, matched_amount, confidence, review_reason } = req.data as IngestAgentMatchPayload

            await INSERT.into(DbMatchResult).entries({
                match_id,
                open_item_OpenItemId: open_item_id,
                matched_amount,
                confidence,
                review_reason,
                match_status: Number(confidence) > 0.8 ? 'MATCHED' : 'NEEDS_REVIEW',
                action_required: Number(confidence) <= 0.8,
            })

            return 'Match stored successfully'
        })

        // 3. Action triggered from Fiori UI for automated analysis
        this.on('analyzeWithGemini', async (req: Request) => {
            const rows = await SELECT.from(DbOpenItem)

            if (!rows || rows.length === 0) {
                return 'No open items to analyze.'
            }

            let processed = 0

            for (const item of rows) {
                const itemId = String(item.OpenItemId)
                const customerName = String(item.CustomerName ?? 'Unknown Customer')
                const invoiceAmount = Number(item.InvoiceAmount ?? 0)

                const mockBankStatement = `Payment for invoice ${itemId} - ${customerName}`

                const agentResult = await this.callAgentAPI({
                    OpenItemId: itemId,
                    CustomerName: customerName,
                    InvoiceAmount: invoiceAmount
                }, mockBankStatement)

                const status = agentResult.review_required || agentResult.confidence < 0.85
                    ? 'NEEDS_REVIEW'
                    : 'MATCHED'

                const matchId = `MATCH-AUTO-${itemId}`

                await UPSERT.into(DbMatchResult).entries({
                    match_id: matchId,
                    open_item_OpenItemId: itemId,
                    matched_amount: invoiceAmount,
                    match_status: status,
                    review_status: status === 'NEEDS_REVIEW' ? 'PENDING' : 'APPROVED',
                    confidence: agentResult.confidence,
                    review_reason: agentResult.reason,
                    action_required: status === 'NEEDS_REVIEW'
                })

                processed++
            }

            return `Analyzed ${processed} items. Results saved.`
        })

        // 4. Local-first pipeline: extraction -> matching -> persistence.
        // SAP AI Hub (orchestration) by default, optional OpenRouter via CASH_AI_PROVIDER.
        // Disabled AI uses explicit local mocks, never fallback after a live error.
        const loadOpenItems = async (): Promise<OpenItem[]> => {
            if (process.env.CASH_S4_ENABLED === 'true') {
                return getLiveOpenItems()
            }
            const rows = await SELECT.from(DbOpenItem)
            return rows.map((row: Record<string, unknown>) => ({
                openItemId: String(row.OpenItemId),
                companyCode: String(row.CompanyCode),
                customerAccount: String(row.CustomerAccount),
                customerName: String(row.CustomerName),
                invoiceAmount: Number(row.InvoiceAmount),
                invoiceAmountCurrency: String(row.InvoiceAmountCurr),
                clearingStatus: String(row.ClearingStatus),
            }))
        }

        const resolveProvider = async () => {
            if (process.env.CASH_AI_ENABLED !== 'true') {
                return import('./agents/integration-mocks.js')
            }
            return (await import('./genai/index.js')).getProvider()
        }

        const providerMode = () =>
            process.env.CASH_AI_ENABLED === 'true' ? (process.env.CASH_AI_PROVIDER ?? 'openrouter') : 'mock'

        const runPipeline = async (pdfBytes: Buffer): Promise<PipelineResult> => {
            const provider = await resolveProvider()
            const payment = await extractPayment(pdfBytes, provider.extractDocument)
            const openItems = await loadOpenItems()
            const candidates = await proposeMatches(payment, openItems, provider.generateText)
            return { payment, candidates, openItems }
        }

        const persistPayment = async (payment: ExtractedPayment, candidates: ProposedMatchCandidate[]): Promise<{ paymentId: string, matchCount: number }> => {
            const { Payments, ProposedMatches } = cds.entities('poc.cashapp')
            const paymentId = randomUUID()
            const status = payment.extractionConfidence < LOW_CONFIDENCE_THRESHOLD ? 'needsReview' : 'matched'
            const persistedCandidates = status === 'needsReview' ? [] : candidates
            await INSERT.into(Payments).entries({
                ID: paymentId,
                payer: payment.payer,
                amount: payment.amount,
                currency: payment.currency,
                valueDate: payment.valueDate,
                references: payment.references,
                extractionConfidence: payment.extractionConfidence,
                status,
            })
            await INSERT.into(ProposedMatches).entries(persistedCandidates.map(candidate => ({
                payment_ID: paymentId,
                openItemId: candidate.openItemId,
                companyCode: candidate.companyCode,
                customerAccount: candidate.customerAccount,
                amount: candidate.amount,
                currency: candidate.currency,
                matchStatus: candidate.matchStatus,
                matchScore: candidate.matchScore,
                rationale: candidate.rationale,
            })))
            return { paymentId, matchCount: persistedCandidates.length }
        }

        const decodeFileContent = (fileContent: unknown): Buffer => {
            if (Buffer.isBuffer(fileContent)) return fileContent
            if (typeof fileContent === 'string') return Buffer.from(fileContent, 'base64')
            throw new Error('fileContent must be a Buffer or a base64-encoded string.')
        }

        const storeUpload = async (req: Request, fileName: string, fileContent: unknown) => {
            let pdfBytes: Buffer
            try {
                pdfBytes = decodeFileContent(fileContent)
            } catch (err) {
                const error = err as Error
                return req.error(400, `Could not decode fileContent for "${fileName}": ${error.message}`)
            }
            let payment: ExtractedPayment
            let candidates: ProposedMatchCandidate[]
            try {
                ({ payment, candidates } = await runPipeline(pdfBytes))
            } catch (err) {
                const error = err as Error
                return req.error(422, `Extraction failed for "${fileName}": ${error.message}`)
            }
            const { Payments } = cds.entities('poc.cashapp')
            const { paymentId } = await persistPayment(payment, candidates)
            return SELECT.one.from(Payments, paymentId)
        }

        this.on('processPaymentDocument', async (req: Request) => {
            const { pdfBase64 } = req.data as ProcessPaymentDocumentPayload
            if (!pdfBase64) req.error({ code: '400', message: 'pdfBase64 is required' })
            const pdfBytes = Buffer.from(pdfBase64 ?? '', 'base64')

            const { payment, candidates } = await runPipeline(pdfBytes)
            const { paymentId, matchCount } = await persistPayment(payment, candidates)

            return `Stored ${matchCount} proposed match(es) for payment ${paymentId}`
        })

        // Manual-upload entry point mirroring the reference workflow: raw PDF
        // bytes in, stored Payment row out (matches readable via composition).
        this.on('uploadPayment', async (req: Request) => {
            const { fileName, fileContent } = req.data as { fileName: string; fileContent: unknown }
            return storeUpload(req, fileName, fileContent)
        })

        // Open Items browser: live S/4 read when enabled, honest 503 otherwise.
        // An empty/omitted customerAccount fetches the whole set.
        this.on('getOpenItems', async (req: Request) => {
            const { customerAccount } = req.data as { customerAccount?: string }
            if (process.env.CASH_S4_ENABLED === 'true') {
                return getLiveOpenItems(customerAccount || undefined)
            }
            const rows = await loadOpenItems()
            return rows.map(item => ({
                openItemId: item.openItemId,
                postingDate: null,
                documentDate: null,
                companyCode: item.companyCode,
                customerAccount: item.customerAccount,
                customerName: item.customerName,
                invoiceAmountCurrency: item.invoiceAmountCurrency,
                invoiceAmount: item.invoiceAmount,
                clearingStatus: item.clearingStatus,
            }))
        })

        // 5b. Review queue: approve triggers the S/4 clearing post (the ONLY
        // place allowed to call postClearing); reject is a pure status flip.
        // Without S/4 enabled approve fails honestly with 503, no status change.
        const SAP_MESSAGE_FAILURE_SEVERITY = 3

        this.on('approveMatch', 'ProposedMatches', async (req: Request) => {
            const { ProposedMatches } = cds.entities('poc.cashapp')
            const [{ ID }] = req.params as [{ ID: string }]
            const match = await SELECT.one.from(ProposedMatches, ID)
            if (!match) return req.error(404, `ProposedMatches ${ID} not found.`)
            if (process.env.CASH_S4_ENABLED !== 'true') {
                return req.error(503, 'S/4 posting is disabled. Set CASH_S4_ENABLED=true only after explicit approval.')
            }

            await UPDATE.entity(ProposedMatches, ID).with({ reviewStatus: 'approved' })

            const [result] = await postClearing([{
                openItemId: match.openItemId,
                companyCode: match.companyCode,
                amount: Number(match.amount),
                currency: match.currency,
                customer: match.customerAccount,
            }])
            const failed = result.sapMessages.some((m: SapMessage) => m.numericSeverity >= SAP_MESSAGE_FAILURE_SEVERITY)

            await UPDATE.entity(ProposedMatches, ID).with(failed
                ? {
                    reviewStatus: 'approved',
                    postingId: null,
                    documentNumber: null,
                    postingError: result.sapMessages.map((m: SapMessage) => `[${m.code}] ${m.message}`).join('; ')
                        || 'Posting failed with no SAP message detail.',
                }
                : {
                    reviewStatus: 'posted',
                    postingId: result.postingId,
                    documentNumber: result.documentNumber,
                    postingError: null,
                })

            return SELECT.one.from(ProposedMatches, ID)
        })

        this.on('rejectMatch', 'ProposedMatches', async (req: Request) => {
            const { ProposedMatches } = cds.entities('poc.cashapp')
            const [{ ID }] = req.params as [{ ID: string }]
            const match = await SELECT.one.from(ProposedMatches, ID)
            if (!match) return req.error(404, `ProposedMatches ${ID} not found.`)

            await UPDATE.entity(ProposedMatches, ID).with({ reviewStatus: 'rejected' })

            return SELECT.one.from(ProposedMatches, ID)
        })

        // 5. One-click sample validation from the UI: runs the same pipeline
        // over the bundled fixture PDF and mirrors the verdict into MatchResult
        // rows so it shows up in the main list report (match IDs AI-VALID-*).
        this.on('validateSampleDocument', async () => {
            const samplePath = join(cds.root, SAMPLE_PDF_PATH)
            let pdfBytes: Buffer
            try {
                pdfBytes = await readFile(samplePath)
            } catch {
                return `Sample PDF not found at ${samplePath}. Start the server from the project root (npm run dev).`
            }

            const { payment, candidates, openItems } = await runPipeline(pdfBytes)
            const { paymentId } = await persistPayment(payment, candidates)

            const itemsById = new Map(openItems.map(item => [item.openItemId, item]))
            const verdicts: string[] = []
            let rowsWritten = 0

            for (const candidate of candidates) {
                if (!candidate.openItemId) continue
                const item = itemsById.get(candidate.openItemId)
                const matched = candidate.matchStatus === 'full'
                const matchedAmount = item ? item.invoiceAmount : 0
                const variance = matched
                    ? 0
                    : Math.round((matchedAmount - payment.amount) * 100) / 100
                const matchId = `AI-VALID-${candidate.openItemId}`.slice(0, 36)

                await UPSERT.into(DbMatchResult).entries({
                    match_id: matchId,
                    open_item_OpenItemId: candidate.openItemId,
                    matched_amount: matchedAmount,
                    variance_amount: variance,
                    match_status: matched ? 'MATCHED' : 'NEEDS_REVIEW',
                    review_status: matched ? 'APPROVED' : 'PENDING',
                    confidence: candidate.matchScore,
                    review_reason: candidate.rationale.slice(0, 500),
                    source_label: 'AI_SAMPLE_VALIDATION',
                    action_required: !matched,
                })
                rowsWritten++
                verdicts.push(
                    `- ${candidate.openItemId}${item ? ` (${item.customerName})` : ''}: `
                    + `${candidate.matchStatus} (score ${candidate.matchScore}) -> ${matchId}`
                )
            }

            const references = payment.references.length > 0 ? payment.references.join(', ') : '(none)'
            return [
                `Validation finished (provider: ${providerMode()}).`,
                `Extracted payment: ${payment.payer} — ${payment.amount.toFixed(2)} ${payment.currency}, `
                    + `value date ${payment.valueDate} (extraction confidence: ${payment.extractionConfidence}).`,
                `References: ${references}`,
                rowsWritten > 0
                    ? `Match verdicts stored in MatchResult (match IDs prefixed AI-VALID-):\n${verdicts.join('\n')}`
                    : 'No verdict rows: the AI did not link this payment to any open item (see ProposedMatches for the rationale).',
                `Stored payment ${paymentId} with ${candidates.length} proposed match(es); `
                    + `MatchResult updated for ${rowsWritten} open item(s).`,
            ].join('\n')
        })

        return super.init()
    }

    /** Helper method to call the Agent API with fallback support */
    private async callAgentAPI(openItemData: { OpenItemId: string, CustomerName: string, InvoiceAmount: number }, bankStatementText: string): Promise<AgentResponse> {
        const apiKey = process.env.GEMINI_API_KEY

        if (!apiKey) {
            LOG.warn('No API key in environment. Using simulation...')
            const isAmbiguous = Math.random() > 0.5
            return {
                confidence: isAmbiguous ? 0.60 : 0.98,
                review_required: isAmbiguous,
                reason: isAmbiguous 
                    ? 'Discrepancy detected in transfer title and amount.' 
                    : 'Full match of transfer data with SAP document.'
            }
        }

        const prompt = `
You are an AI agent analyzing bank payment matches with open items in SAP.
Analyze the SAP open item and the bank transfer description, and determine if manual human review is required.

SAP Document Data:
- Item Number: ${openItemData.OpenItemId}
- Customer Name: ${openItemData.CustomerName}
- Amount: ${openItemData.InvoiceAmount}

Bank Transfer Text:
"${bankStatementText}"

Return a JSON object with this exact schema:
{
  "confidence": number, // Float between 0.0 and 1.0
  "review_required": boolean,
  "reason": string // A short explanation in English
}
`

        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
                {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.1
                    }
                },
                { headers: { 'Content-Type': 'application/json' } }
            )

            const jsonText = response.data.candidates[0].content.parts[0].text
            return JSON.parse(jsonText) as AgentResponse
        } catch (error: any) {
            LOG.error('API call error:', error.response?.data || error.message)
            return {
                confidence: 0.0,
                review_required: true,
                reason: 'Connection error with the analytics module.'
            }
        }
    }
}