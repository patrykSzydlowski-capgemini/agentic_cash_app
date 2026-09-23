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
import { activeModelName } from './genai/index.js'

if (!process.env.VCAP_SERVICES) {
    try {
        // @ts-expect-error @sap/xsenv does not bundle type declarations
        const xsenv = (await import('@sap/xsenv')).default
        xsenv.loadEnv()
    } catch {
        // ignore if default-env.json missing
    }
}

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

        // Live S/4HANA Read handler for OpenItem entity in Fiori UI
        this.on('READ', 'OpenItem', async (req: Request, next: Function) => {
            if (process.env.CASH_S4_ENABLED !== 'true') {
                return next()
            }
            try {
                const liveItems = await getLiveOpenItems()
                LOG.info(`[OpenItem READ] Returning ${liveItems.length} live item(s) from S/4HANA`)
                return liveItems.map(item => ({
                    OpenItemId: item.openItemId,
                    CompanyCode: item.companyCode,
                    CustomerAccount: item.customerAccount,
                    CustomerName: item.customerName,
                    InvoiceAmount: item.invoiceAmount,
                    InvoiceAmountCurr: item.invoiceAmountCurrency,
                    ClearingStatus: item.clearingStatus,
                    PostingDate: item.postingDate,
                    DocumentDate: item.documentDate,
                }))
            } catch (err) {
                LOG.warn(`[OpenItem READ] Failed to fetch from S/4HANA, falling back to SQLite: ${(err as Error).message}`)
                return next()
            }
        })

        // 1. Manual approval from the UI
        this.on('triggerAIAgent', 'MatchResult', async (req: Request) => {
            const first = req.params[0] as { match_id?: string } | string | undefined
            const matchId = typeof first === 'object' ? (first?.match_id ?? first) : first

            LOG.info(`[Operator Action] Manual approval triggered for MatchResult ID: ${matchId}`)

            await UPDATE.entity(DbMatchResult)
                .set({
                    match_status: 'MATCHED',
                    action_required: false,
                    review_status: 'APPROVED',
                    review_reason: 'Manually approved by operator'
                })
                .where({ match_id: matchId })

            LOG.info(`[Operator Action] MatchResult ${matchId} updated -> Status: MATCHED, Review: APPROVED`)
            req.notify(`Agent successfully processed record ${matchId}`)
        })

        // 2. Webhook / Action for external match ingestion
        this.on('ingestAgentMatch', async (req: Request) => {
            const { match_id, open_item_id, matched_amount, confidence, review_reason } = req.data as IngestAgentMatchPayload
            const matchStatus = Number(confidence) > 0.8 ? 'MATCHED' : 'NEEDS_REVIEW'

            LOG.info(`[Ingest Match] Ingesting match ${match_id} for open item ${open_item_id} (amount: ${matched_amount}, confidence: ${confidence}) -> status: ${matchStatus}`)

            await INSERT.into(DbMatchResult).entries({
                match_id,
                open_item_OpenItemId: open_item_id,
                matched_amount,
                confidence,
                review_reason,
                match_status: matchStatus,
                action_required: Number(confidence) <= 0.8,
            })

            LOG.info(`[Ingest Match] Successfully stored MatchResult ${match_id}`)
            return 'Match stored successfully'
        })

        // 3. Action triggered from Fiori UI for automated analysis
        this.on('analyzeWithGemini', async (req: Request) => {
            const rows = await SELECT.from(DbOpenItem)

            if (!rows || rows.length === 0) {
                LOG.warn('[Gemini Analysis] No open items found to analyze.')
                return 'No open items to analyze.'
            }

            LOG.info(`[Gemini Analysis] Starting AI analysis for ${rows.length} open item(s)...`)
            let processed = 0

            for (const item of rows) {
                const itemId = String(item.OpenItemId)
                const customerName = String(item.CustomerName ?? 'Unknown Customer')
                const invoiceAmount = Number(item.InvoiceAmount ?? 0)

                const mockBankStatement = `Payment for invoice ${itemId} - ${customerName}`

                LOG.info(`[Gemini Analysis] (${processed + 1}/${rows.length}) Analyzing item ${itemId} (${customerName}, ${invoiceAmount} USD)...`)

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

                LOG.info(`[Gemini Analysis] Saved verdict ${matchId}: status=${status}, confidence=${agentResult.confidence}, reason="${agentResult.reason}"`)
                processed++
            }

            LOG.info(`[Gemini Analysis] Batch analysis complete. Successfully saved ${processed} item(s).`)
            return `Analyzed ${processed} items. Results saved.`
        })

        // 4. Local-first pipeline: extraction -> matching -> persistence.
        // SAP AI Hub (orchestration) by default, optional OpenRouter via CASH_AI_PROVIDER.
        // Disabled AI uses explicit local mocks, never fallback after a live error.
        const loadOpenItems = async (): Promise<OpenItem[]> => {
            const source = process.env.CASH_S4_ENABLED === 'true' ? 'Live S/4HANA' : 'Local SQLite'
            LOG.info(`[ERP Open Items] Loading open items from ${source}...`)
            if (process.env.CASH_S4_ENABLED === 'true') {
                const liveItems = await getLiveOpenItems()
                LOG.info(`[ERP Open Items] Loaded ${liveItems.length} open item(s) from S/4HANA`)
                try {
                    await UPSERT.into(DbOpenItem).entries(liveItems.map(item => ({
                        OpenItemId: item.openItemId,
                        CompanyCode: item.companyCode,
                        CustomerAccount: item.customerAccount,
                        CustomerName: item.customerName,
                        InvoiceAmount: item.invoiceAmount,
                        InvoiceAmountCurr: item.invoiceAmountCurrency,
                        ClearingStatus: item.clearingStatus,
                        PostingDate: item.postingDate,
                        DocumentDate: item.documentDate,
                    })))
                } catch (e) {
                    LOG.warn(`[ERP Open Items] Cache sync to SQLite warning: ${(e as Error).message}`)
                }
                return liveItems
            }
            const rows = await SELECT.from(DbOpenItem)
            LOG.info(`[ERP Open Items] Loaded ${rows.length} open item(s) from SQLite`)
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

        const providerMode = () => {
            if (process.env.CASH_AI_ENABLED !== 'true') return 'mock'
            const name = process.env.CASH_AI_PROVIDER ?? 'aicore'
            const model = activeModelName()
            if (name === 'aicore') {
                const dest = process.env.AICORE_DESTINATION ? `destination: ${process.env.AICORE_DESTINATION}` : 'service binding'
                const rg = process.env.AICORE_RESOURCE_GROUP || 'default'
                return `aicore [model: ${model}, ${dest}, resourceGroup: ${rg}]`
            }
            return `openrouter [model: ${model}]`
        }

        const runPipeline = async (pdfBytes: Buffer): Promise<PipelineResult> => {
            const t0 = Date.now()
            const pMode = providerMode()
            const model = activeModelName()
            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            LOG.info(`🚀 [AI Pipeline] Starting payment processing`)
            LOG.info(`   ↳ File Size: ${pdfBytes.length} bytes`)
            LOG.info(`   ↳ Engine: ${pMode}`)
            LOG.info(`   ↳ Model: ${model}`)

            const tExtract = Date.now()
            LOG.info(`🤖 [Step 1/3: Extraction Agent] Extracting payment fields from PDF using "${model}"...`)
            const provider = await resolveProvider()
            const payment = await extractPayment(pdfBytes, provider.extractDocument)
            const durationExtract = Date.now() - tExtract
            LOG.info(`✅ [Step 1/3: Extraction Agent] Extraction completed in ${durationExtract}ms (${(durationExtract / 1000).toFixed(2)}s):`, {
                model,
                payer: payment.payer,
                amount: `${payment.amount} ${payment.currency}`,
                valueDate: payment.valueDate,
                references: payment.references,
                confidence: payment.extractionConfidence
            })

            const tMatch = Date.now()
            LOG.info(`🔍 [Step 2/3: Matching Agent] Fetching ERP open items and calculating candidates...`)
            const openItems = await loadOpenItems()
            const candidates = await proposeMatches(payment, openItems, provider.generateText)
            const durationMatch = Date.now() - tMatch
            LOG.info(`🎯 [Step 2/3: Matching Agent] Found ${candidates.length} match candidate(s) in ${durationMatch}ms (${(durationMatch / 1000).toFixed(2)}s):`)
            for (const c of candidates) {
                LOG.info(`   ↳ [${c.matchStatus.toUpperCase()}] Item: ${c.openItemId || '(none)'} | Score: ${c.matchScore} | ${c.rationale}`)
            }
            const totalPipelineTime = Date.now() - t0
            LOG.info(`⏱ [AI Pipeline] Processing finished in ${totalPipelineTime}ms (${(totalPipelineTime / 1000).toFixed(2)}s) [Extraction: ${durationExtract}ms | Matching: ${durationMatch}ms]`)
            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            return { payment, candidates, openItems }
        }

        const persistPayment = async (payment: ExtractedPayment, candidates: ProposedMatchCandidate[]): Promise<{ paymentId: string, matchCount: number }> => {
            const tPersist = Date.now()
            const { Payments, ProposedMatches } = cds.entities('poc.cashapp')
            const paymentId = randomUUID()
            const status = payment.extractionConfidence < LOW_CONFIDENCE_THRESHOLD ? 'needsReview' : 'matched'
            const persistedCandidates = status === 'needsReview' ? [] : candidates
            LOG.info(`💾 [Step 3/3: Persistence] Saving payment ${paymentId} with status="${status}" (${persistedCandidates.length} match(es) stored)...`)
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
            const durationPersist = Date.now() - tPersist
            LOG.info(`✅ [Step 3/3: Persistence] Successfully stored payment ${paymentId} in ${durationPersist}ms`)
            return { paymentId, matchCount: persistedCandidates.length }
        }

        const decodeFileContent = (fileContent: unknown): Buffer => {
            if (Buffer.isBuffer(fileContent)) return fileContent
            if (typeof fileContent === 'string') return Buffer.from(fileContent, 'base64')
            throw new Error('fileContent must be a Buffer or a base64-encoded string.')
        }

        const storeUpload = async (req: Request, fileName: string, fileContent: unknown) => {
            const tUploadStart = Date.now()
            LOG.info(`📥 [Upload] Received file upload: "${fileName}"`)
            let pdfBytes: Buffer
            try {
                pdfBytes = decodeFileContent(fileContent)
                LOG.info(`📥 [Upload] Decoded file "${fileName}": ${pdfBytes.length} bytes`)
            } catch (err) {
                const error = err as Error
                LOG.error(`❌ [Upload] Could not decode fileContent for "${fileName}": ${error.message}`)
                return req.error(400, `Could not decode fileContent for "${fileName}": ${error.message}`)
            }
            let payment: ExtractedPayment
            let candidates: ProposedMatchCandidate[]
            try {
                ({ payment, candidates } = await runPipeline(pdfBytes))
            } catch (err) {
                const error = err as Error
                LOG.error(`❌ [Upload] Pipeline failed for "${fileName}" after ${Date.now() - tUploadStart}ms: ${error.message}`)
                return req.error(422, `Extraction failed for "${fileName}": ${error.message}`)
            }
            const { Payments } = cds.entities('poc.cashapp')
            const { paymentId } = await persistPayment(payment, candidates)
            const totalUploadDuration = Date.now() - tUploadStart
            LOG.info(`🎉 [Upload] Complete! Stored payment ${paymentId} for file "${fileName}" in ${totalUploadDuration}ms (${(totalUploadDuration / 1000).toFixed(2)}s)`)
            return SELECT.one.from(Payments, paymentId)
        }

        this.on('processPaymentDocument', async (req: Request) => {
            const { pdfBase64 } = req.data as ProcessPaymentDocumentPayload
            if (!pdfBase64) req.error({ code: '400', message: 'pdfBase64 is required' })
            LOG.info(`⚙️ [Process] processPaymentDocument triggered (payload length: ${pdfBase64?.length ?? 0} chars)`)
            const pdfBytes = Buffer.from(pdfBase64 ?? '', 'base64')

            const { payment, candidates } = await runPipeline(pdfBytes)
            const { paymentId, matchCount } = await persistPayment(payment, candidates)

            LOG.info(`🎉 [Process] Complete! Stored ${matchCount} proposed match(es) for payment ${paymentId}`)
            return `Stored ${matchCount} proposed match(es) for payment ${paymentId}`
        })

        // Manual-upload entry point mirroring the reference workflow: raw PDF
        // bytes in, stored Payment row out (matches readable via composition).
        this.on('uploadPayment', async (req: Request) => {
            const { fileName, fileContent } = req.data as { fileName: string; fileContent: unknown }
            return storeUpload(req, fileName, fileContent)
        })

        // Operator action: re-evaluates selected payment(s) against ERP open items via AI agent.
        this.on('reprocessWithAI', 'Payments', async (req: Request) => {
            const { Payments, ProposedMatches } = cds.entities('poc.cashapp')
            const [{ ID }] = req.params as [{ ID: string }]
            const payment = await SELECT.one.from(Payments, ID)
            if (!payment) return req.error(404, `Payment ${ID} not found.`)

            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            LOG.info(`🔄 [AI Re-validation] Starting AI re-validation for payment ${ID} (${payment.payer}, ${payment.amount} ${payment.currency})`)
            const openItems = await loadOpenItems()
            let references: string[] = []
            if (Array.isArray(payment.references)) {
                references = payment.references
            } else if (typeof payment.references === 'string') {
                try {
                    const parsed = JSON.parse(payment.references)
                    references = Array.isArray(parsed) ? parsed : [payment.references]
                } catch {
                    references = [payment.references]
                }
            }

            let newScore: number = 0.30
            let matchedItemId: string = ''
            let matchStatus: 'full' | 'probable' | 'toBeChecked' | 'noMatch' = 'noMatch'
            let rationale: string = ''

            if (process.env.CASH_AI_ENABLED === 'true') {
                const tReval = Date.now()
                const model = activeModelName()
                LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
                LOG.info(`🤖 [AI Re-validation] Re-evaluating payment with GenAI...`)
                LOG.info(`   ↳ Payment: ID=${payment.ID}, Payer="${payment.payer}", Amount=${payment.amount} ${payment.currency}`)
                LOG.info(`   ↳ Engine: ${providerMode()}`)
                LOG.info(`   ↳ Model: ${model}`)
                const provider = await (await import('./genai/index.js')).getProvider()
                const prompt = `You are an AI Cash Application Matching Agent in SAP.
An operator has requested an AI re-validation of a payment against open ERP invoices.

Payment details:
- Payer: "${payment.payer}"
- Amount: ${payment.amount} ${payment.currency}
- Value Date: ${payment.valueDate}
- References: ${references.length > 0 ? references.join(', ') : '(none)'}

Available ERP Open Items:
${openItems.map(item => `- Item: ${item.openItemId}, Customer: "${item.customerName}", Amount: ${item.invoiceAmount} ${item.invoiceAmountCurrency}, Status: ${item.clearingStatus}`).join('\n')}

Analyze the payment and find the matching open item in ERP (if any).
Assess a realistic confidence score between 0.00 and 1.00 (e.g. 0.95 for exact match, 0.70-0.85 for probable match, 0.10-0.30 if no match).
Return ONLY a single valid JSON object (no markdown, no quotes around json):
{
  "confidence": number,
  "matchedOpenItemId": string,
  "matchStatus": "full" | "probable" | "toBeChecked" | "noMatch",
  "rationale": string
}`

                try {
                    const raw = await provider.generateText(prompt)
                    const cleanJson = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
                    const parsed = JSON.parse(cleanJson)
                    newScore = typeof parsed.confidence === 'number' ? Math.round(parsed.confidence * 100) / 100 : 0.50
                    matchedItemId = String(parsed.matchedOpenItemId || '').trim()
                    matchStatus = parsed.matchStatus || (newScore >= 0.8 ? 'full' : (newScore >= 0.5 ? 'probable' : 'noMatch'))
                    rationale = String(parsed.rationale || '')
                    const durationReval = Date.now() - tReval
                    LOG.info(`✅ [AI Re-validation] Completed in ${durationReval}ms (${(durationReval / 1000).toFixed(2)}s):`)
                    LOG.info(`   ↳ Model used: ${model}`)
                    LOG.info(`   ↳ Confidence: ${newScore}`)
                    LOG.info(`   ↳ Matched item: ${matchedItemId || '(none)'}`)
                    LOG.info(`   ↳ Match status: ${matchStatus}`)
                    LOG.info(`   ↳ Rationale: ${rationale}`)
                    LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
                } catch (err) {
                    LOG.warn(`⚠️ [AI Re-validation] GenAI failed after ${Date.now() - tReval}ms, falling back to deterministic matching: ${(err as Error).message}`)
                }
            }

            // Fallback / deterministic evaluation if AI disabled or returned no item
            if (!matchedItemId && process.env.CASH_AI_ENABLED !== 'true') {
                const extracted: ExtractedPayment = {
                    payer: payment.payer,
                    amount: Number(payment.amount),
                    currency: payment.currency,
                    valueDate: payment.valueDate,
                    references,
                    extractionConfidence: Number(payment.extractionConfidence ?? 0),
                }
                const candidates = await proposeMatches(extracted, openItems)
                const best = candidates.find(c => c.openItemId && c.matchStatus !== 'noMatch')
                if (best) {
                    matchedItemId = best.openItemId
                    matchStatus = best.matchStatus
                    newScore = best.matchStatus === 'full' ? 0.95 : (best.matchStatus === 'probable' ? 0.75 : 0.50)
                    rationale = best.rationale
                } else {
                    newScore = 0.25
                    matchStatus = 'noMatch'
                    rationale = candidates[0]?.rationale || 'No matching open item found in ERP.'
                }
            }

            const newStatus = newScore >= 0.8 ? 'matched' : 'needsReview'
            const matchedItem = openItems.find(i => i.openItemId === matchedItemId)

            // Replace proposed matches for this payment
            await DELETE.from(ProposedMatches).where({ payment_ID: ID })
            await INSERT.into(ProposedMatches).entries({
                payment_ID: ID,
                openItemId: matchedItemId || '(brak dopasowania)',
                companyCode: matchedItem?.companyCode || '1000',
                customerAccount: matchedItem?.customerAccount || '',
                amount: matchedItem?.invoiceAmount || payment.amount,
                currency: matchedItem?.invoiceAmountCurrency || payment.currency,
                matchStatus,
                matchScore: newScore,
                reviewStatus: newStatus === 'matched' ? 'approved' : 'pending',
                rationale: rationale || `AI rewalidacja: status ${matchStatus} z oceną ${newScore.toFixed(2)}.`,
            })

            const oldScore = Number(payment.extractionConfidence ?? 0).toFixed(2)
            const updatedScore = Number(newScore).toFixed(2)
            LOG.info(`💾 [AI Re-validation] Updating Payment ${ID}: confidence: ${oldScore} -> ${updatedScore}, status: "${payment.status}" -> "${newStatus}"`)

            await UPDATE.entity(Payments, ID).with({
                extractionConfidence: newScore,
                status: newStatus,
            })

            LOG.info(`✅ [AI Re-validation] Completed for payment ${ID}`)
            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

            const toastMsg = matchedItemId
                ? `Rewalidacja AI (${payment.payer}): ocena ${updatedScore}, status: ${newStatus}, dopasowanie: ${matchedItemId}`
                : `Rewalidacja AI (${payment.payer}): ocena ${updatedScore}, status: ${newStatus} (brak dopasowania)`
            req.notify(toastMsg)

            return SELECT.one.from(Payments, ID)
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
            if (!match) {
                LOG.warn(`[Review Action] ProposedMatches ${ID} not found.`)
                return req.error(404, `ProposedMatches ${ID} not found.`)
            }
            LOG.info(`👤 [Review Action] Operator approving match ${ID} for open item ${match.openItemId} (${match.customerAccount}, ${match.amount} ${match.currency})`)
            if (process.env.CASH_S4_ENABLED !== 'true') {
                LOG.warn(`[S/4 Clearing] S/4 posting is disabled (CASH_S4_ENABLED !== 'true'). Returning 503.`)
                return req.error(503, 'S/4 posting is disabled. Set CASH_S4_ENABLED=true only after explicit approval.')
            }

            await UPDATE.entity(ProposedMatches, ID).with({ reviewStatus: 'approved' })

            LOG.info(`🏦 [S/4 Clearing] Posting clearance document to S/4HANA for open item ${match.openItemId}...`)
            const [result] = await postClearing([{
                openItemId: match.openItemId,
                companyCode: match.companyCode,
                amount: Number(match.amount),
                currency: match.currency,
                customer: match.customerAccount,
            }])
            const failed = result.sapMessages.some((m: SapMessage) => m.numericSeverity >= SAP_MESSAGE_FAILURE_SEVERITY)

            if (failed) {
                const errorMsg = result.sapMessages.map((m: SapMessage) => `[${m.code}] ${m.message}`).join('; ')
                    || 'Posting failed with no SAP message detail.'
                LOG.error(`❌ [S/4 Clearing] Posting failed: ${errorMsg}`)
                await UPDATE.entity(ProposedMatches, ID).with({
                    reviewStatus: 'approved',
                    postingId: null,
                    documentNumber: null,
                    postingError: errorMsg,
                })
            } else {
                LOG.info(`✅ [S/4 Clearing] Posting succeeded! DocumentNumber: ${result.documentNumber}, PostingId: ${result.postingId}`)
                await UPDATE.entity(ProposedMatches, ID).with({
                    reviewStatus: 'posted',
                    postingId: result.postingId,
                    documentNumber: result.documentNumber,
                    postingError: null,
                })
            }

            return SELECT.one.from(ProposedMatches, ID)
        })

        this.on('rejectMatch', 'ProposedMatches', async (req: Request) => {
            const { ProposedMatches } = cds.entities('poc.cashapp')
            const [{ ID }] = req.params as [{ ID: string }]
            const match = await SELECT.one.from(ProposedMatches, ID)
            if (!match) {
                LOG.warn(`[Review Action] ProposedMatches ${ID} not found.`)
                return req.error(404, `ProposedMatches ${ID} not found.`)
            }

            LOG.info(`👤 [Review Action] Operator rejecting match ${ID} for open item ${match.openItemId}`)
            await UPDATE.entity(ProposedMatches, ID).with({ reviewStatus: 'rejected' })
            LOG.info(`✅ [Review Action] ProposedMatches ${ID} status set to "rejected"`)

            return SELECT.one.from(ProposedMatches, ID)
        })

        // 5. One-click sample validation from the UI: runs the same pipeline
        // over the bundled fixture PDF and mirrors the verdict into MatchResult
        // rows so it shows up in the main list report (match IDs AI-VALID-*).
        this.on('validateSampleDocument', async () => {
            const samplePath = join(cds.root, SAMPLE_PDF_PATH)
            LOG.info(`🧪 [Sample Validation] Starting validation of bundled fixture: ${samplePath}`)
            let pdfBytes: Buffer
            try {
                pdfBytes = await readFile(samplePath)
            } catch {
                LOG.error(`❌ [Sample Validation] Sample PDF not found at ${samplePath}`)
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

            LOG.info(`🏁 [Sample Validation] Completed! Stored ${rowsWritten} verdict(s) in MatchResult table.`)
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