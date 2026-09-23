import cds from '@sap/cds'
import type { Request } from '@sap/cds'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ingestAgentMatch, processPaymentDocument } from '../@cds-models/CashSyncService/index.js'
import { extractPayment } from './agents/extraction-agent.js'
import type { ExtractedPayment } from './agents/extraction-agent.js'
import { proposeMatches } from './agents/matching-agent.js'
import type { ProposedMatchCandidate } from './agents/matching-agent.js'
import type { OpenItem } from './s4/open-items-client.js'
import { getOpenItems as getLiveOpenItems } from './s4/open-items-client.js'
import { postClearing, type SapMessage, type ClearingResult } from './s4/clearing-client.js'
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

// Bundled remittance advice fixtures used by the UI's sample-validation button.
const SAMPLE_FIXTURE_FILES = [
    { file: 'sample-awizo-100pct.pdf', label: '100% Match' },
    { file: 'sample-awizo-50pct.pdf', label: '~50-60% Partial Match' },
    { file: 'sample-awizo-0pct.pdf', label: '0% No Match' },
]

interface PipelineResult {
    payment: ExtractedPayment
    candidates: ProposedMatchCandidate[]
    openItems: OpenItem[]
}

export default class CashSyncServiceImpl extends cds.ApplicationService {
    async init() {
        // Seed environment defaults from cds.env.requires (package.json) if not set in process.env
        const cdsAi = (cds.env?.requires as Record<string, any> | undefined)?.aicore
        if (!process.env.AICORE_DESTINATION && cdsAi?.credentials?.destination) {
            process.env.AICORE_DESTINATION = cdsAi.credentials.destination
        }
        if (!process.env.AICORE_MODEL && cdsAi?.model) {
            process.env.AICORE_MODEL = cdsAi.model
        }
        if (!process.env.AICORE_RESOURCE_GROUP && cdsAi?.resourceGroup) {
            process.env.AICORE_RESOURCE_GROUP = cdsAi.resourceGroup
        }
        const cdsS4 = (cds.env?.requires as Record<string, any> | undefined)?.s4
        if (!process.env.S4_DESTINATION_NAME && cdsS4?.credentials?.destination) {
            process.env.S4_DESTINATION_NAME = cdsS4.credentials.destination
        }

        const { MatchResult: DbMatchResult, OpenItem: DbOpenItem } = cds.entities('poc.cash')

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
                const cdsAi = (cds.env?.requires as Record<string, any> | undefined)?.aicore
                const destinationName = process.env.AICORE_DESTINATION?.trim() || cdsAi?.credentials?.destination
                const dest = destinationName ? `destination: ${destinationName}` : 'service binding'
                const rg = process.env.AICORE_RESOURCE_GROUP || cdsAi?.resourceGroup || 'default'
                return `aicore [model: ${model}, ${dest}, resourceGroup: ${rg}]`
            }
            return `openrouter [model: ${model}]`
        }

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

        // 1. AI re-validation for a specific MatchResult row (real AI agent)
        this.on('triggerAIAgent', 'MatchResult', async (req: Request) => {
            const first = req.params[0] as { match_id?: string } | string | undefined
            const matchId = typeof first === 'object' ? (first?.match_id ?? first) : first

            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            LOG.info(`🤖 [AI Re-validation] Triggered AI agent for MatchResult ID: ${matchId}`)

            const match = await SELECT.one.from(DbMatchResult, matchId)
            if (!match) return req.error(404, `MatchResult ${matchId} not found.`)

            const openItem = match.open_item_OpenItemId
                ? await SELECT.one.from(DbOpenItem, match.open_item_OpenItemId)
                : null

            let confidence = 0.50
            let matchStatus = 'NEEDS_REVIEW'
            let reviewStatus = 'PENDING'
            let actionRequired = true
            let reason = ''

            const invoiceAmount = openItem ? Number(openItem.InvoiceAmount) : Number(match.matched_amount || 0)
            const matchedAmount = Number(match.matched_amount || 0)
            const customerName = openItem?.CustomerName || 'Unknown Customer'
            const itemId = openItem?.OpenItemId || match.open_item_OpenItemId || 'N/A'

            if (process.env.CASH_AI_ENABLED === 'true') {
                const t0 = Date.now()
                const model = activeModelName()
                LOG.info(`   ↳ Engine: ${providerMode()}`)
                LOG.info(`   ↳ Model: ${model}`)
                LOG.info(`   ↳ Item: ${itemId} (${customerName}), Invoice: ${invoiceAmount}, Matched: ${matchedAmount}`)

                try {
                    const provider = await resolveProvider()
                    const prompt = `You are an AI Cash Application Matching Agent in SAP.
An operator requested an AI re-evaluation for MatchResult "${matchId}".

Details:
- Open Item / Invoice ID: "${itemId}"
- Customer Name: "${customerName}"
- SAP Invoice Amount: ${invoiceAmount}
- Payment / Matched Amount: ${matchedAmount}
- Current Variance: ${match.variance_amount ?? (invoiceAmount - matchedAmount)}

Evaluate whether this payment matches the open item.
Return ONLY a single valid JSON object (no markdown, no quotes):
{
  "confidence": number, // Float between 0.00 and 1.00
  "match_status": "MATCHED" | "NEEDS_REVIEW" | "REJECTED",
  "review_status": "APPROVED" | "PENDING" | "REJECTED",
  "action_required": boolean,
  "reason": string // Concise explanation for the operator
}`
                    const raw = await provider.generateText(prompt)
                    const cleanJson = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
                    const parsed = JSON.parse(cleanJson)

                    confidence = typeof parsed.confidence === 'number' ? Math.round(parsed.confidence * 100) / 100 : 0.50
                    matchStatus = parsed.match_status || (confidence >= 0.85 ? 'MATCHED' : 'NEEDS_REVIEW')
                    reviewStatus = parsed.review_status || (matchStatus === 'MATCHED' ? 'APPROVED' : 'PENDING')
                    actionRequired = typeof parsed.action_required === 'boolean' ? parsed.action_required : matchStatus !== 'MATCHED'
                    reason = String(parsed.reason || '')
                    LOG.info(`✅ [AI Re-validation] Completed in ${Date.now() - t0}ms: status=${matchStatus}, conf=${confidence}, reason="${reason}"`)
                } catch (err) {
                    LOG.warn(`⚠️ [AI Re-validation] GenAI call failed: ${(err as Error).message}. Falling back to deterministic matching.`)
                }
            }

            // Deterministic evaluation if AI is disabled or failed
            if (!reason) {
                const diff = Math.abs(invoiceAmount - matchedAmount)
                if (diff < 0.01) {
                    confidence = 1.0
                    matchStatus = 'MATCHED'
                    reviewStatus = 'APPROVED'
                    actionRequired = false
                    reason = `Pełne dopasowanie: kwota płatności (${matchedAmount}) w 100% odpowiada pozycji SAP (${invoiceAmount}).`
                } else if (matchedAmount < invoiceAmount) {
                    confidence = 0.50
                    matchStatus = 'NEEDS_REVIEW'
                    reviewStatus = 'PENDING'
                    actionRequired = true
                    reason = `Płatność częściowa: kwota płatności (${matchedAmount}) jest mniejsza niż kwota pozycji SAP (${invoiceAmount}) — wymaga weryfikacji.`
                } else {
                    confidence = 0.40
                    matchStatus = 'NEEDS_REVIEW'
                    reviewStatus = 'PENDING'
                    actionRequired = true
                    reason = `Nadpłata: kwota płatności (${matchedAmount}) przekracza kwotę pozycji SAP (${invoiceAmount}) — wymaga weryfikacji.`
                }
            }

            await UPDATE.entity(DbMatchResult)
                .set({
                    confidence,
                    match_status: matchStatus,
                    review_status: reviewStatus,
                    action_required: actionRequired,
                    review_reason: reason
                })
                .where({ match_id: matchId })

            LOG.info(`[AI Re-validation] MatchResult ${matchId} updated -> Status: ${matchStatus}, Confidence: ${confidence}`)
            req.notify(`Agent AI przeanalizował pozycję ${matchId}: ${matchStatus} (${(confidence * 100).toFixed(0)}%)`)
            return SELECT.one.from(DbMatchResult, matchId)
        })

        // 2. Manual operator approval from the UI
        this.on('manualApprove', 'MatchResult', async (req: Request) => {
            const first = req.params[0] as { match_id?: string } | string | undefined
            const matchId = typeof first === 'object' ? (first?.match_id ?? first) : first

            LOG.info(`[Operator Action] Manual approval triggered for MatchResult ID: ${matchId}`)

            await UPDATE.entity(DbMatchResult)
                .set({
                    match_status: 'MATCHED',
                    action_required: false,
                    review_status: 'APPROVED',
                    review_reason: 'Ręcznie zatwierdzone przez operatora'
                })
                .where({ match_id: matchId })

            LOG.info(`[Operator Action] MatchResult ${matchId} updated -> Status: MATCHED, Review: APPROVED`)
            req.notify(`Pozycja ${matchId} została zatwierdzona ręcznie przez operatora`)
            return SELECT.one.from(DbMatchResult, matchId)
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

            const hasValidMatch = candidates.some(c => (c.matchStatus === 'full' || c.matchStatus === 'probable') && Boolean(c.openItemId))
            const lowConfidence = payment.extractionConfidence < LOW_CONFIDENCE_THRESHOLD
            const bestCandidate = candidates.reduce<ProposedMatchCandidate | null>(
                (best, cur) => (!best || cur.matchScore > best.matchScore ? cur : best),
                null
            )
            const matchScore = bestCandidate ? bestCandidate.matchScore : 0
            const status = (lowConfidence || !hasValidMatch || matchScore < LOW_CONFIDENCE_THRESHOLD) ? 'needsReview' : 'matched'
            // If extraction confidence is too low, candidates are omitted per reference policy.
            // If extraction succeeded but no match was found in ERP, persist the candidates so the operator sees the rationale.
            const persistedCandidates = lowConfidence ? [] : candidates
            // Effective AI confidence: if extraction failed (<0.6), report extraction confidence;
            // if extraction succeeded, report the ERP matching score (0 for no match, ~0.6 for partial, 1.0 for full).
            const effectiveConfidence = lowConfidence ? payment.extractionConfidence : matchScore
            const primaryRationale = lowConfidence
                ? `Ekstrakcja o niskiej pewności (${(payment.extractionConfidence * 100).toFixed(0)}%): wymagana weryfikacja dokumentu.`
                : (candidates[0]?.rationale || 'Brak propozycji dopasowania.')

            LOG.info(`💾 [Step 3/3: Persistence] Saving payment ${paymentId} with status="${status}", confidence=${effectiveConfidence} (${persistedCandidates.length} candidate(s) stored)...`)
            await INSERT.into(Payments).entries({
                ID: paymentId,
                payer: payment.payer,
                amount: payment.amount,
                currency: payment.currency,
                valueDate: payment.valueDate,
                references: payment.references,
                extractionConfidence: effectiveConfidence,
                status,
                rationale: primaryRationale,
            })
            if (persistedCandidates.length > 0) {
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
            }
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

            let finalCandidates: ProposedMatchCandidate[] = []
            let newScore: number = 0.30
            let primaryRationale: string = ''

            const extracted: ExtractedPayment = {
                payer: payment.payer,
                amount: Number(payment.amount),
                currency: payment.currency,
                valueDate: payment.valueDate,
                references,
                extractionConfidence: Number(payment.extractionConfidence ?? 0),
            }

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

Analyze the payment and find the matching open item(s) in ERP. If the payment covers multiple open items, identify all of them.
Assess a realistic confidence score between 0.00 and 1.00 (e.g. 0.95 for exact match / exact multi-item sum, 0.70-0.85 for probable match, 0.10-0.30 if no match).
Return ONLY a single valid JSON object (no markdown, no quotes around json):
{
  "confidence": number,
  "matchedOpenItemIds": string[],
  "matchStatus": "full" | "probable" | "toBeChecked" | "noMatch",
  "rationale": string
}`

                try {
                    const raw = await provider.generateText(prompt)
                    const cleanJson = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
                    const parsed = JSON.parse(cleanJson)
                    const conf = typeof parsed.confidence === 'number' ? Math.round(parsed.confidence * 100) / 100 : 0.50
                    newScore = conf
                    primaryRationale = String(parsed.rationale || '')
                    const rawItemIds = parsed.matchedOpenItemIds || (parsed.matchedOpenItemId ? [parsed.matchedOpenItemId] : [])
                    const matchedItemIds: string[] = Array.isArray(rawItemIds) ? rawItemIds.map(String).map(s => s.trim()).filter(Boolean) : []
                    const mStatus = parsed.matchStatus || (newScore >= 0.8 ? 'full' : (newScore >= 0.5 ? 'probable' : 'noMatch'))

                    if (matchedItemIds.length > 0) {
                        finalCandidates = matchedItemIds.map(id => {
                            const found = openItems.find(i => i.openItemId === id)
                            return {
                                openItemId: id,
                                companyCode: found?.companyCode || '1000',
                                customerAccount: found?.customerAccount || '',
                                amount: found?.invoiceAmount || payment.amount,
                                currency: found?.invoiceAmountCurrency || payment.currency,
                                matchStatus: mStatus,
                                matchScore: newScore,
                                rationale: primaryRationale,
                            }
                        })
                    }

                    const durationReval = Date.now() - tReval
                    LOG.info(`✅ [AI Re-validation] Completed in ${durationReval}ms (${(durationReval / 1000).toFixed(2)}s):`)
                    LOG.info(`   ↳ Model used: ${model}`)
                    LOG.info(`   ↳ Confidence: ${newScore}`)
                    LOG.info(`   ↳ Matched item(s): ${matchedItemIds.join(', ') || '(none)'}`)
                    LOG.info(`   ↳ Rationale: ${primaryRationale}`)
                    LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
                } catch (err) {
                    LOG.warn(`⚠️ [AI Re-validation] GenAI failed after ${Date.now() - tReval}ms, falling back to deterministic matching: ${(err as Error).message}`)
                }
            }

            // Fallback / deterministic evaluation if AI disabled or returned no items
            if (finalCandidates.length === 0) {
                const candidates = await proposeMatches(extracted, openItems)
                const validMatches = candidates.filter(c => c.openItemId && c.matchStatus !== 'noMatch')
                if (validMatches.length > 0) {
                    finalCandidates = validMatches.map(c => ({
                        ...c,
                        matchScore: c.matchStatus === 'full' ? 0.95 : (c.matchStatus === 'probable' ? 0.75 : 0.50),
                    }))
                    const best = finalCandidates.reduce((acc, cur) => cur.matchScore > acc.matchScore ? cur : acc, finalCandidates[0])
                    newScore = best.matchScore
                    primaryRationale = best.rationale
                } else {
                    newScore = 0.25
                    primaryRationale = candidates[0]?.rationale || 'No matching open item found in ERP.'
                }
            }

            const newStatus = newScore >= 0.8 ? 'matched' : 'needsReview'

            // Replace proposed matches for this payment
            await DELETE.from(ProposedMatches).where({ payment_ID: ID })
            if (finalCandidates.length > 0) {
                await INSERT.into(ProposedMatches).entries(finalCandidates.map(c => ({
                    payment_ID: ID,
                    openItemId: c.openItemId,
                    companyCode: c.companyCode || '1000',
                    customerAccount: c.customerAccount || '',
                    amount: c.amount,
                    currency: c.currency,
                    matchStatus: c.matchStatus,
                    matchScore: c.matchScore,
                    reviewStatus: newStatus === 'matched' ? 'approved' : 'pending',
                    rationale: c.rationale || primaryRationale || `AI rewalidacja: status ${c.matchStatus} z oceną ${c.matchScore.toFixed(2)}.`,
                })))
            } else {
                await INSERT.into(ProposedMatches).entries({
                    payment_ID: ID,
                    openItemId: '(brak dopasowania)',
                    companyCode: '1000',
                    customerAccount: '',
                    amount: payment.amount,
                    currency: payment.currency,
                    matchStatus: 'noMatch',
                    matchScore: newScore,
                    reviewStatus: 'pending',
                    rationale: primaryRationale || `AI rewalidacja: brak dopasowania (ocena ${newScore.toFixed(2)}).`,
                })
            }

            const oldScore = Number(payment.extractionConfidence ?? 0).toFixed(2)
            const updatedScore = Number(newScore).toFixed(2)
            LOG.info(`💾 [AI Re-validation] Updating Payment ${ID}: confidence: ${oldScore} -> ${updatedScore}, status: "${payment.status}" -> "${newStatus}"`)

            await UPDATE.entity(Payments, ID).with({
                extractionConfidence: newScore,
                status: newStatus,
                rationale: primaryRationale || `AI rewalidacja: status ${newStatus} z oceną ${newScore.toFixed(2)}.`,
            })

            LOG.info(`✅ [AI Re-validation] Completed for payment ${ID}`)
            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

            const toastMsg = finalCandidates.length > 0
                ? `Rewalidacja AI (${payment.payer}): ocena ${updatedScore}, status: ${newStatus}, dopasowano ${finalCandidates.length} pozycji: ${finalCandidates.map(c => c.openItemId).join(', ')}`
                : `Rewalidacja AI (${payment.payer}): ocena ${updatedScore}, status: ${newStatus} (brak dopasowania)`
            req.notify(toastMsg)

            return SELECT.one.from(Payments, ID)
        })

        // Operator action: manually posts a validated payment to S/4HANA clearing.
        this.on('postToS4', 'Payments', async (req: Request) => {
            const { Payments, ProposedMatches } = cds.entities('poc.cashapp')
            const [{ ID }] = req.params as [{ ID: string }]
            const payment = await SELECT.one.from(Payments, ID)
            if (!payment) return req.error(404, `Payment ${ID} not found.`)

            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            LOG.info(`🏦 [Manual Post] Operator triggered S/4HANA posting for payment ${ID} (${payment.payer}, ${payment.amount} ${payment.currency})`)

            if (payment.status === 'cleared') {
                return req.error(400, `Płatność dla ${payment.payer} została już wcześniej zaksięgowana w S/4HANA.`)
            }

            const matches = await SELECT.from(ProposedMatches).where({ payment_ID: ID })
            const validMatches = matches.filter((m: any) => m.openItemId && m.openItemId !== '(brak dopasowania)' && m.openItemId !== '')

            if (validMatches.length === 0) {
                LOG.warn(`[Manual Post] No valid open item associated with payment ${ID}.`)
                return req.error(400, `Płatność (${payment.payer}) nie posiada powiązanej otwartej pozycji w SAP. Dopasuj pozycję przed zaksięgowaniem.`)
            }

            const pendingMatches = validMatches.filter((m: any) => m.reviewStatus !== 'posted')
            if (pendingMatches.length === 0) {
                return req.error(400, `Wszystkie pozycje dla ${payment.payer} zostały już zaksięgowane w S/4HANA.`)
            }

            if (process.env.CASH_S4_ENABLED !== 'true') {
                LOG.warn(`[S/4 Clearing] S/4 posting is disabled (CASH_S4_ENABLED !== 'true').`)
                return req.error(503, 'Księgowanie w S/4HANA jest wyłączone. Ustaw CASH_S4_ENABLED=true tylko za zgodą.')
            }

            LOG.info(`🏦 [S/4 Clearing] Posting ${pendingMatches.length} clearance document(s) to S/4HANA for payment ${ID}...`)
            const clearingMatches = pendingMatches.map((m: any) => ({
                openItemId: m.openItemId,
                companyCode: m.companyCode || '1000',
                amount: Number(m.amount || payment.amount),
                currency: m.currency || payment.currency,
                customer: m.customerAccount || '',
            }))

            let results: ClearingResult[]
            try {
                results = await postClearing(clearingMatches)
            } catch (networkErr: any) {
                const errorMsg = networkErr?.message || String(networkErr)
                LOG.error(`❌ [S/4 Clearing] S/4HANA Destination/Connectivity error: ${errorMsg}`)
                for (const m of pendingMatches) {
                    await UPDATE.entity(ProposedMatches, m.ID).with({
                        reviewStatus: 'approved',
                        postingId: null,
                        documentNumber: null,
                        postingError: errorMsg,
                    })
                }
                return req.error(502, `Błąd połączenia z S/4HANA: ${errorMsg}`)
            }

            const SAP_FAIL_SEVERITY = 3
            let hasFailures = false
            const docNumbers: string[] = []

            for (let i = 0; i < pendingMatches.length; i++) {
                const match = pendingMatches[i]
                const result = results[i]
                const failed = !result || result.sapMessages.some((m: SapMessage) => m.numericSeverity >= SAP_FAIL_SEVERITY)

                if (failed) {
                    hasFailures = true
                    const errorMsg = result?.sapMessages?.map((m: SapMessage) => `[${m.code}] ${m.message}`).join('; ')
                        || 'Posting failed with no SAP message detail.'
                    LOG.error(`❌ [S/4 Clearing] Item ${match.openItemId} posting failed: ${errorMsg}`)
                    await UPDATE.entity(ProposedMatches, match.ID).with({
                        reviewStatus: 'approved',
                        postingId: null,
                        documentNumber: null,
                        postingError: errorMsg,
                    })
                } else {
                    LOG.info(`✅ [S/4 Clearing] Item ${match.openItemId} posting succeeded! DocumentNumber: ${result.documentNumber}, PostingId: ${result.postingId}`)
                    docNumbers.push(result.documentNumber)
                    await UPDATE.entity(ProposedMatches, match.ID).with({
                        reviewStatus: 'posted',
                        postingId: result.postingId,
                        documentNumber: result.documentNumber,
                        postingError: null,
                    })
                }
            }

            if (!hasFailures) {
                const remainingUnposted = await SELECT.from(ProposedMatches)
                    .where({ payment_ID: ID })
                    .and({ reviewStatus: { '!=': 'posted' } })

                if (remainingUnposted.length === 0) {
                    await UPDATE.entity(Payments, ID).with({
                        status: 'cleared',
                    })
                    LOG.info(`✅ [Manual Post] All items posted. Payment ${ID} status updated to "cleared"`)
                }
                LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
                req.notify(`Płatność (${payment.payer}) została pomyślnie zaksięgowana w S/4HANA (${docNumbers.length} pozycji). Nr dok.: ${docNumbers.join(', ')}`)
                return SELECT.one.from(Payments, ID)
            } else {
                LOG.warn(`⚠️ [Manual Post] Partial or complete failure during posting for payment ${ID}`)
                return req.error(502, `Błąd księgowania w S/4HANA: część pozycji nie została zaksięgowana.`)
            }
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
                if (match.payment_ID) {
                    const { Payments } = cds.entities('poc.cashapp')
                    const unpostedMatches = await SELECT.from(ProposedMatches)
                        .where({ payment_ID: match.payment_ID })
                        .and({ ID: { '!=': ID } })
                        .and({ reviewStatus: { '!=': 'posted' } })

                    if (unpostedMatches.length === 0) {
                        await UPDATE.entity(Payments, match.payment_ID).with({ status: 'cleared' })
                        LOG.info(`✅ [Review Action] All matches posted. Payment ${match.payment_ID} status set to "cleared".`)
                    } else {
                        LOG.info(`ℹ️ [Review Action] Payment ${match.payment_ID} still has ${unpostedMatches.length} unposted match(es).`)
                    }
                }
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

        // 5. One-click sample validation from the UI: runs the AI pipeline over
        // all 3 sample remittance fixtures (100% exact match, ~50-60% partial match, 0% no match)
        // and stores verdicts in MatchResult and Payments tables.
        this.on('validateSampleDocument', async () => {
            LOG.info(`🧪 [Sample Validation] Starting validation of 3 sample remittance fixtures...`)
            const verdicts: string[] = []
            let totalRowsWritten = 0

            for (const fixture of SAMPLE_FIXTURE_FILES) {
                let pdfBytes: Buffer
                try {
                    pdfBytes = await readFile(join(cds.root, fixture.file))
                } catch {
                    try {
                        pdfBytes = await readFile(join(cds.root, 'test-fixtures', fixture.file))
                    } catch {
                        LOG.warn(`[Sample Validation] Could not load fixture: ${fixture.file}`)
                        continue
                    }
                }

                const { payment, candidates, openItems } = await runPipeline(pdfBytes)
                const { paymentId } = await persistPayment(payment, candidates)
                const itemsById = new Map(openItems.map(item => [item.openItemId, item]))

                for (const candidate of candidates) {
                    const hasItem = Boolean(candidate.openItemId)
                    const item = hasItem ? itemsById.get(candidate.openItemId) : null
                    const matched = candidate.matchStatus === 'full'
                    const matchedAmount = item ? item.invoiceAmount : (candidate.amount || payment.amount)
                    const variance = matched ? 0 : Math.round((matchedAmount - payment.amount) * 100) / 100
                    const slug = hasItem ? candidate.openItemId : `NOMATCH-${Math.round(payment.amount)}`
                    const matchId = `AI-VALID-${slug}`.slice(0, 36)

                    const matchStatus = matched
                        ? 'MATCHED'
                        : (candidate.matchStatus === 'noMatch' ? 'REJECTED' : 'NEEDS_REVIEW')
                    const reviewStatus = matched
                        ? 'APPROVED'
                        : (candidate.matchStatus === 'noMatch' ? 'REJECTED' : 'PENDING')

                    await UPSERT.into(DbMatchResult).entries({
                        match_id: matchId,
                        open_item_OpenItemId: candidate.openItemId || null,
                        matched_amount: matchedAmount,
                        variance_amount: variance,
                        match_status: matchStatus,
                        review_status: reviewStatus,
                        confidence: candidate.matchScore,
                        review_reason: candidate.rationale.slice(0, 500),
                        source_label: 'AI_SAMPLE_VALIDATION',
                        action_required: !matched,
                    })
                    totalRowsWritten++
                    verdicts.push(
                        `- [${(candidate.matchScore * 100).toFixed(0)}%] ${payment.payer} (${payment.amount} ${payment.currency}) `
                        + `-> ${matchStatus} (Score: ${candidate.matchScore}, Pozycja: ${candidate.openItemId || '(brak)'})`
                    )
                }
            }

            LOG.info(`🏁 [Sample Validation] Completed! Stored ${totalRowsWritten} verdict(s) across 3 sample records.`)
            return [
                `Walidacja 3 przykładowych awizo zakończona pomyślnie (${providerMode()}):`,
                ...verdicts,
                `Wszystkie 3 wpisy (100%, ~50-60%, 0%) zostały zapisane w tabeli Dopasowań oraz Płatności.`
            ].join('\n')
        })

        // Cascade cleanup when Payments are deleted by user from the UI
        this.before('DELETE', 'Payments', async (req: Request) => {
            const id = req.data?.ID || (req.params as [{ ID?: string }])?.[0]?.ID
            if (id) {
                const { IngestionLog } = cds.entities('poc.cashapp')
                await cds.tx(req).run(DELETE.from(IngestionLog).where({ payment_ID: id }))
                LOG.info(`🗑️ [Delete] Cleaned up IngestionLog for Payment ${id}`)
            }
        })

        // Cleanup when MatchResult rows are deleted by user from the UI
        this.before('DELETE', 'MatchResult', async (req: Request) => {
            const id = req.data?.match_id || (req.params as [{ match_id?: string }])?.[0]?.match_id
            if (id) {
                const { ManualTask } = cds.entities('poc.cash')
                await cds.tx(req).run(DELETE.from(ManualTask).where({ match_match_id: id }))
                LOG.info(`🗑️ [Delete] Cleaned up ManualTask for MatchResult ${id}`)
            }
        })

        return super.init()
    }
}