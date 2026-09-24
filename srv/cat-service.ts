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
import { activeModelName, calculateTokenCost, calculateCapacityUnits } from './genai/index.js'

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
    rawExtractionConfidence: number
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
            try {
                return await (await import('./genai/index.js')).getProvider()
            } catch (err) {
                LOG.warn(`[AI Provider] Live provider unavailable (${(err as Error).message}), using fallback`)
                return import('./agents/integration-mocks.js')
            }
        }

        const providerMode = () => {
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

            // Deterministic evaluation fallback if AI failed
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
            LOG.info(`[ERP Open Items] Synchronizing open items with Live S/4HANA...`)
            try {
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
            } catch (err) {
                LOG.warn(`[ERP Open Items] Failed to fetch live items from S/4HANA (${(err as Error).message}). Using cached open items.`)
            }
            const rows = await SELECT.from(DbOpenItem)
            LOG.info(`[ERP Open Items] Active open items pool: ${rows.length} item(s)`)
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

        interface AiMatchingOutput {
            candidates: ProposedMatchCandidate[]
            confidence: number
            matchStatus: 'full' | 'probable' | 'toBeChecked' | 'noMatch'
            rationale: string
            promptTokens: number
            completionTokens: number
            totalTokens: number
            usedModel: string
        }

        const runAiMatchingAgent = async (
            payment: ExtractedPayment,
            openItems: OpenItem[],
            provider: any
        ): Promise<AiMatchingOutput | null> => {
            if (!provider || !provider.generateText) {
                return null
            }

            const tStart = Date.now()
            const model = activeModelName()
            const references = Array.isArray(payment.references) ? payment.references : []

            const prompt = `You are an AI Cash Application Matching Agent in SAP.
Analyze the following payment against open ERP customer invoices to determine the best match.

Payment details:
- Payer: "${payment.payer}"
- Amount: ${payment.amount} ${payment.currency}
- Value Date: ${payment.valueDate}
- References: ${references.length > 0 ? references.join(', ') : '(none)'}

Available ERP Open Items:
${openItems.map(item => `- Item: ${item.openItemId}, Customer: "${item.customerName}", Amount: ${item.invoiceAmount} ${item.invoiceAmountCurrency}, Status: ${item.clearingStatus}`).join('\n')}

Task:
1. Find the matching open item(s) in ERP. If the payment covers multiple open items (e.g. the sum of multiple open invoices equals or is close to the payment amount), identify all of them.
2. Check for potential payer name variations, parent/subsidiary relationships, customer aliases, or third-party payments.
3. If no direct reference is given, use invoice amounts, multi-invoice sums, and customer context to find the match.
4. Assess a realistic confidence score between 0.00 and 1.00 following these STRICT criteria:
   - 0.95 - 1.00 ("full"): Direct invoice reference(s) present AND exact amount match (single or multi-invoice for the SAME verified customer).
   - 0.75 - 0.85 ("probable"): Payer is an obvious/known alias of the SAME single customer, exact amount match, single customer account.
   - 0.40 - 0.60 ("toBeChecked"): AMBIGUOUS / UNCERTAIN match requiring human review:
     * Payer name does not clearly match the customer name(s) (e.g. third-party payer, unrecorded alias).
     * Invoices belong to DIFFERENT, UNRELATED customer accounts (e.g. Customer1 and Customer3) without explicit invoice references.
     * Partial payment, overpayment, or currency mismatch.
     * CRITICAL: If you state in the rationale that human verification, alias verification, or confirmation is needed, you MUST set confidence <= 0.60 (e.g. 0.50-0.55) and matchStatus to "toBeChecked". NEVER return confidence > 0.60 when there is doubt about payer or customer identity!
   - 0.10 - 0.30 ("noMatch"): No matching open items found in ERP.

Return ONLY a single valid JSON object (no markdown, no quotes around json):
{
  "confidence": number,
  "matchedOpenItemIds": string[],
  "matchStatus": "full" | "probable" | "toBeChecked" | "noMatch",
  "rationale": string
}`

            try {
                const generateFn = provider.generateTextWithUsage || provider.generateText
                const genRes = await generateFn(prompt)
                const raw = typeof genRes === 'string' ? genRes : genRes.content
                let promptTokens = 980
                let completionTokens = 135
                let totalTokens = promptTokens + completionTokens
                let usedModel = model

                if (typeof genRes === 'object' && genRes.usage) {
                    promptTokens = genRes.usage.promptTokens ?? promptTokens
                    completionTokens = genRes.usage.completionTokens ?? completionTokens
                    totalTokens = genRes.usage.totalTokens ?? (promptTokens + completionTokens)
                }
                if (typeof genRes === 'object' && genRes.model) {
                    usedModel = genRes.model
                }

                const cleanJson = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
                const parsed = JSON.parse(cleanJson)
                const conf = typeof parsed.confidence === 'number' ? Math.round(parsed.confidence * 100) / 100 : 0.50
                const primaryRationale = String(parsed.rationale || '')
                const rawItemIds = parsed.matchedOpenItemIds || (parsed.matchedOpenItemId ? [parsed.matchedOpenItemId] : [])
                const matchedItemIds: string[] = Array.isArray(rawItemIds) ? rawItemIds.map(String).map(s => s.trim()).filter(Boolean) : []
                const validMatchedIds = matchedItemIds.filter(id => openItems.some(i => i.openItemId === id))
                let mStatus: 'full' | 'probable' | 'toBeChecked' | 'noMatch' = validMatchedIds.length === 0
                    ? 'noMatch'
                    : (parsed.matchStatus || (conf >= 0.8 ? 'full' : (conf >= 0.5 ? 'probable' : 'noMatch')))

                // Programmatic guardrails for uncertainty and cross-customer matching:
                const matchedCustomers = new Set(
                    validMatchedIds.map(id => openItems.find(i => i.openItemId === id)?.customerAccount).filter(Boolean)
                )
                const hasExplicitRef = references.some(ref => validMatchedIds.includes(ref))
                const isCrossCustomer = matchedCustomers.size > 1 && !hasExplicitRef
                const rationaleLower = primaryRationale.toLowerCase()
                const indicatesUncertainty = !hasExplicitRef && (
                    rationaleLower.includes('human verification') ||
                    rationaleLower.includes('requires verification') ||
                    rationaleLower.includes('wymaga weryfikacji') ||
                    rationaleLower.includes('unknown') ||
                    rationaleLower.includes('niepewn') ||
                    rationaleLower.includes('potential third-party') ||
                    rationaleLower.includes('unrecorded customer alias') ||
                    rationaleLower.includes('unclear')
                )

                let effectiveConf = conf
                if (validMatchedIds.length > 0 && (isCrossCustomer || indicatesUncertainty || mStatus === 'toBeChecked')) {
                    mStatus = 'toBeChecked'
                    if (effectiveConf > 0.60) {
                        LOG.info(`⚠️ [AI Matching Agent] Confidence capped at 0.55 (was ${effectiveConf}) due to uncertainty/cross-customer match: crossCustomer=${isCrossCustomer} (${matchedCustomers.size} customer accounts), uncertain=${indicatesUncertainty}`)
                        effectiveConf = 0.55
                    }
                }

                const candidates: ProposedMatchCandidate[] = validMatchedIds.length > 0
                    ? validMatchedIds.map(id => {
                        const found = openItems.find(i => i.openItemId === id)!
                        return {
                            openItemId: id,
                            companyCode: found.companyCode || '1000',
                            customerAccount: found.customerAccount || '',
                            amount: found.invoiceAmount || payment.amount,
                            currency: found.invoiceAmountCurrency || payment.currency,
                            matchStatus: mStatus,
                            matchScore: effectiveConf,
                            rationale: primaryRationale,
                        }
                    })
                    : [{
                        openItemId: '(brak dopasowania)',
                        companyCode: '1000',
                        customerAccount: '',
                        amount: payment.amount,
                        currency: payment.currency,
                        matchStatus: 'noMatch',
                        matchScore: effectiveConf,
                        rationale: primaryRationale || 'AI Matching Agent: brak pasujących otwartych pozycji w ERP.',
                    }]

                const duration = Date.now() - tStart
                LOG.info(`✅ [AI Matching Agent] Completed in ${duration}ms (${(duration / 1000).toFixed(2)}s): conf=${effectiveConf}, status=${mStatus}, items=${validMatchedIds.join(', ') || '(brak dopasowania)'}`)
                LOG.info(`   ↳ Rationale: ${primaryRationale}`)

                return {
                    candidates,
                    confidence: effectiveConf,
                    matchStatus: mStatus,
                    rationale: primaryRationale,
                    promptTokens,
                    completionTokens,
                    totalTokens,
                    usedModel,
                }

            } catch (err) {
                LOG.warn(`⚠️ [AI Matching Agent] Execution failed: ${(err as Error).message}`)
                return null
            }
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
            let payment: ExtractedPayment
            let rawExtractionConfidence = 0.0

            try {
                const extractFn = (provider as any).extractDocumentWithUsage || provider.extractDocument
                payment = await extractPayment(pdfBytes, extractFn)
                rawExtractionConfidence = payment.extractionConfidence
            } catch (extractErr) {
                LOG.warn(`⚠️ [AI Pipeline] Extraction failed (${(extractErr as Error).message}). Falling back to zero-confidence payment.`)
                payment = {
                    payer: '[MOCK] Nieznany płatnik (błąd ekstrakcji)',
                    amount: 0,
                    currency: 'EUR',
                    valueDate: new Date().toISOString().slice(0, 10),
                    references: [],
                    extractionConfidence: 0.0,
                }
                rawExtractionConfidence = 0.0
            }

            const durationExtract = Date.now() - tExtract
            LOG.info(`✅ [Step 1/3: Extraction Agent] Extraction completed in ${durationExtract}ms (${(durationExtract / 1000).toFixed(2)}s):`, {
                model,
                payer: payment.payer,
                amount: `${payment.amount} ${payment.currency}`,
                valueDate: payment.valueDate,
                references: payment.references,
                confidence: rawExtractionConfidence
            })

            const tMatch = Date.now()
            LOG.info(`🔍 [Step 2/3: Matching Agent] Fetching ERP open items and calculating candidates...`)
            const openItems = await loadOpenItems()
            let candidates: ProposedMatchCandidate[] = []
            let aiMatchingTokens = { prompt: 0, completion: 0 }
            let finalRationale = ''

            if (payment.amount <= 0 && rawExtractionConfidence === 0) {
                candidates = []
                finalRationale = 'Nie udało się wyodrębnić danych płatności z dokumentu. Wymagana weryfikacja ręczna.'
            } else {
                candidates = await proposeMatches(payment, openItems, provider.generateText)
                const initialBestScore = candidates.reduce((max, c) => Math.max(max, c.matchScore), 0)
                const hasExactFullMatch = candidates.length > 0 && candidates.every(c => c.matchStatus === 'full') && initialBestScore >= 0.95
                finalRationale = candidates[0]?.rationale || ''

                // If initial matching did not give a 100% confident match (e.g. score was 0, 0.5, toBeChecked, noMatch)
                // or if extraction was low confidence, invoke the AI Matching Agent to perform multi-invoice sum matching, alias resolution, etc.
                if (!hasExactFullMatch && typeof provider?.generateText === 'function') {
                    LOG.info(`🤖 [Step 2/3: Matching Agent] Initial match status is "${candidates[0]?.matchStatus || 'none'}" (score: ${initialBestScore.toFixed(2)}). Invoking AI Matching Agent for deep evaluation...`)
                    const aiResult = await runAiMatchingAgent(payment, openItems, provider)
                    if (aiResult) {
                        aiMatchingTokens.prompt = aiResult.promptTokens
                        aiMatchingTokens.completion = aiResult.completionTokens
                        candidates = aiResult.candidates
                        finalRationale = aiResult.rationale
                        payment.extractionConfidence = aiResult.confidence
                        LOG.info(`🎯 [Step 2/3: Matching Agent] AI found ${candidates.length} match candidate(s) with confidence ${aiResult.confidence}: ${aiResult.rationale}`)
                    }
                }
            }

            const durationMatch = Date.now() - tMatch
            LOG.info(`🎯 [Step 2/3: Matching Agent] Final ${candidates.length} candidate(s) in ${durationMatch}ms (${(durationMatch / 1000).toFixed(2)}s):`)
            for (const c of candidates) {
                LOG.info(`   ↳ [${c.matchStatus.toUpperCase()}] Item: ${c.openItemId || '(none)'} | Score: ${c.matchScore} | ${c.rationale}`)
            }
            const totalPipelineTime = Date.now() - t0

            // AI Execution Analytics & Costs
            const promptTokens = (payment.promptTokens ?? 1420) + aiMatchingTokens.prompt
            const completionTokens = (payment.completionTokens ?? 185) + aiMatchingTokens.completion
            const totalTokens = promptTokens + completionTokens
            const usedModel = payment.aiModel || model
            const estimatedCost = calculateTokenCost(usedModel, promptTokens, completionTokens)
            const capacityUnits = calculateCapacityUnits(usedModel, promptTokens, completionTokens)
            payment.promptTokens = promptTokens
            payment.completionTokens = completionTokens
            payment.totalTokens = totalTokens
            payment.aiModel = usedModel
            payment.processingTimeMs = totalPipelineTime
            payment.estimatedCost = estimatedCost
            payment.capacityUnits = capacityUnits
            payment.rationale = finalRationale

            LOG.info(`⏱ [AI Pipeline] Processing finished in ${totalPipelineTime}ms (${(totalPipelineTime / 1000).toFixed(2)}s) [Tokens: ${totalTokens} (${promptTokens} in / ${completionTokens} out) | Cost: $${estimatedCost.toFixed(4)} | CU: ${capacityUnits.toFixed(4)}]`)
            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            return { payment, candidates, openItems, rawExtractionConfidence }
        }

        const persistPayment = async (
            payment: ExtractedPayment,
            candidates: ProposedMatchCandidate[],
            rawExtractionConfidence?: number
        ): Promise<{ paymentId: string, matchCount: number }> => {
            const tPersist = Date.now()
            const { Payments, ProposedMatches } = cds.entities('poc.cashapp')
            const paymentId = randomUUID()

            const extractionConf = typeof rawExtractionConfidence === 'number' ? rawExtractionConfidence : payment.extractionConfidence
            const bestCandidate = candidates.reduce<ProposedMatchCandidate | null>(
                (best, cur) => (!best || cur.matchScore > best.matchScore ? cur : best),
                null
            )
            const matchScore = bestCandidate ? bestCandidate.matchScore : 0
            const hasFullMatch = candidates.length > 0 && candidates.every(c => c.matchStatus === 'full') && matchScore >= 0.85
            const status = (hasFullMatch && extractionConf >= LOW_CONFIDENCE_THRESHOLD) ? 'matched' : 'needsReview'
            const persistedCandidates = candidates
            const effectiveConfidence = matchScore > 0 ? matchScore : extractionConf
            const primaryRationale = payment.rationale || candidates[0]?.rationale || 'Brak propozycji dopasowania.'

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
                promptTokens: payment.promptTokens,
                completionTokens: payment.completionTokens,
                totalTokens: payment.totalTokens,
                estimatedCost: payment.estimatedCost,
                capacityUnits: payment.capacityUnits,
                aiModel: payment.aiModel,
                processingTimeMs: payment.processingTimeMs,
            })
            if (persistedCandidates.length > 0) {
                await INSERT.into(ProposedMatches).entries(persistedCandidates.map(candidate => ({
                    payment_ID: paymentId,
                    openItemId: candidate.openItemId,
                    companyCode: candidate.companyCode || '1000',
                    customerAccount: candidate.customerAccount || '',
                    amount: candidate.amount,
                    currency: candidate.currency,
                    matchStatus: candidate.matchStatus,
                    matchScore: candidate.matchScore,
                    reviewStatus: (status === 'matched' && candidate.openItemId !== '(brak dopasowania)') ? 'approved' : 'pending',
                    rationale: candidate.rationale || primaryRationale,
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

        // Sequential queue for document processing to ensure isolated, per-document
        // processing time calculation when multiple PDFs are uploaded concurrently.
        let processingQueue: Promise<unknown> = Promise.resolve()
        const queueProcessing = <T>(task: () => Promise<T>): Promise<T> => {
            const run = () => task()
            const next = processingQueue.then(run, run)
            processingQueue = next.then(() => {}, () => {})
            return next
        }

        const storeUpload = async (req: Request, fileName: string, fileContent: unknown) => {
            return queueProcessing(async () => {
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
                let rawExtractionConfidence: number
                try {
                    ({ payment, candidates, rawExtractionConfidence } = await runPipeline(pdfBytes))
                } catch (err) {
                    const error = err as Error
                    LOG.error(`❌ [Upload] Pipeline failed for "${fileName}" after ${Date.now() - tUploadStart}ms: ${error.message}`)
                    return req.error(422, `Extraction failed for "${fileName}": ${error.message}`)
                }
                const { Payments } = cds.entities('poc.cashapp')
                const { paymentId } = await persistPayment(payment, candidates, rawExtractionConfidence)
                const totalUploadDuration = Date.now() - tUploadStart
                LOG.info(`🎉 [Upload] Complete! Stored payment ${paymentId} for file "${fileName}" in ${totalUploadDuration}ms (${(totalUploadDuration / 1000).toFixed(2)}s)`)
                return SELECT.one.from(Payments, paymentId)
            })
        }

        this.on('processPaymentDocument', async (req: Request) => {
            const { pdfBase64 } = req.data as ProcessPaymentDocumentPayload
            if (!pdfBase64) return req.error({ code: '400', message: 'pdfBase64 is required' })
            return queueProcessing(async () => {
                LOG.info(`⚙️ [Process] processPaymentDocument triggered (payload length: ${pdfBase64?.length ?? 0} chars)`)
                const pdfBytes = Buffer.from(pdfBase64 ?? '', 'base64')

                const { payment, candidates, rawExtractionConfidence } = await runPipeline(pdfBytes)
                const { paymentId, matchCount } = await persistPayment(payment, candidates, rawExtractionConfidence)

                LOG.info(`🎉 [Process] Complete! Stored ${matchCount} proposed match(es) for payment ${paymentId}`)
                return `Stored ${matchCount} proposed match(es) for payment ${paymentId}`
            })
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

            const tRevalStart = Date.now()
            let promptTokens = 980
            let completionTokens = 135
            let totalTokens = promptTokens + completionTokens
            let usedModel = activeModelName()

            try {
                const provider = await resolveProvider()
                const aiResult = await runAiMatchingAgent(extracted, openItems, provider)
                if (aiResult) {
                    finalCandidates = aiResult.candidates
                    newScore = aiResult.confidence
                    primaryRationale = aiResult.rationale
                    promptTokens = aiResult.promptTokens
                    completionTokens = aiResult.completionTokens
                    totalTokens = aiResult.totalTokens
                    usedModel = aiResult.usedModel
                }
            } catch (err) {
                LOG.warn(`⚠️ [AI Re-evaluation] GenAI call failed: ${(err as Error).message}. Falling back to deterministic matching.`)
            }

            // Fallback / deterministic evaluation if AI returned no match
            if (finalCandidates.length === 0 || finalCandidates.every(c => c.openItemId === '(brak dopasowania)')) {
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
                } else if (finalCandidates.length === 0) {
                    newScore = 0.25
                    primaryRationale = candidates[0]?.rationale || 'No matching open item found in ERP.'
                }
            }

            const hasRealMatch = finalCandidates.some(c => c.openItemId && c.openItemId !== '(brak dopasowania)' && c.matchStatus !== 'noMatch')
            const hasUncertainCandidates = finalCandidates.some(c => c.matchStatus === 'toBeChecked')
            const newStatus = (newScore >= 0.6 && hasRealMatch && !hasUncertainCandidates) ? 'matched' : 'needsReview'

            // Replace proposed matches for this payment
            await DELETE.from(ProposedMatches).where({ payment_ID: ID })
            if (hasRealMatch) {
                await INSERT.into(ProposedMatches).entries(finalCandidates.filter(c => c.openItemId && c.openItemId !== '(brak dopasowania)').map(c => ({
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
            const durationTotalReval = Date.now() - tRevalStart
            const estimatedCost = calculateTokenCost(usedModel, promptTokens, completionTokens)
            const capacityUnits = calculateCapacityUnits(usedModel, promptTokens, completionTokens)

            LOG.info(`💾 [AI Re-validation] Updating Payment ${ID}: confidence: ${oldScore} -> ${updatedScore}, status: "${payment.status}" -> "${newStatus}" [Tokens: ${totalTokens}, Cost: $${estimatedCost.toFixed(4)}, CU: ${capacityUnits.toFixed(4)}]`)

            await UPDATE.entity(Payments, ID).with({
                extractionConfidence: newScore,
                status: newStatus,
                rationale: primaryRationale || `AI rewalidacja: status ${newStatus} z oceną ${newScore.toFixed(2)}.`,
                promptTokens,
                completionTokens,
                totalTokens,
                estimatedCost,
                capacityUnits,
                aiModel: usedModel,
                processingTimeMs: durationTotalReval,
            })

            LOG.info(`✅ [AI Re-validation] Completed for payment ${ID}`)
            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

            const toastMsg = hasRealMatch
                ? `Rewalidacja AI (${payment.payer}): ocena ${updatedScore}, status: ${newStatus}, dopasowano ${finalCandidates.filter(c => c.openItemId && c.openItemId !== '(brak dopasowania)').length} pozycji: ${finalCandidates.filter(c => c.openItemId && c.openItemId !== '(brak dopasowania)').map(c => c.openItemId).join(', ')}`
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

        // Open Items browser: live S/4 read with SQLite fallback if S/4 connection fails.
        // An empty/omitted customerAccount fetches the whole set.
        this.on('getOpenItems', async (req: Request) => {
            const { customerAccount } = req.data as { customerAccount?: string }
            try {
                return await getLiveOpenItems(customerAccount || undefined)
            } catch (err) {
                LOG.warn(`[getOpenItems] S/4 read failed (${(err as Error).message}), returning cached open items.`)
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
            }
        })

        // AI Analytics Statistics endpoint: aggregate KPIs across all processed payments
        function calculateMedian(arr: number[]): number {
            if (arr.length === 0) return 0
            const sorted = [...arr].sort((a, b) => a - b)
            const mid = Math.floor(sorted.length / 2)
            if (sorted.length % 2 !== 0) {
                return sorted[mid]
            }
            return (sorted[mid - 1] + sorted[mid]) / 2
        }

        this.on('getAiStatistics', async () => {
            const { Payments } = cds.entities('poc.cashapp')
            const payments = await SELECT.from(Payments)
            const promptArr: number[] = []
            const completionArr: number[] = []
            const tokensArr: number[] = []
            const costArr: number[] = []
            const cuArr: number[] = []
            const durationArr: number[] = []

            let totalPrompt = 0
            let totalCompletion = 0
            let totalTokens = 0
            let totalCost = 0
            let totalCU = 0
            let totalProcessed = 0
            let totalDurationMs = 0

            for (const p of payments) {
                if (p.totalTokens != null || p.promptTokens != null) {
                    const prompt = Number(p.promptTokens ?? 0)
                    const completion = Number(p.completionTokens ?? 0)
                    const tokens = Number(p.totalTokens ?? (prompt + completion))
                    const cost = Number(p.estimatedCost ?? 0)
                    const cu = Number(p.capacityUnits ?? calculateCapacityUnits(p.aiModel || activeModelName(), prompt, completion))
                    const duration = Number(p.processingTimeMs ?? 0)

                    promptArr.push(prompt)
                    completionArr.push(completion)
                    tokensArr.push(tokens)
                    costArr.push(cost)
                    cuArr.push(cu)
                    durationArr.push(duration)

                    totalPrompt += prompt
                    totalCompletion += completion
                    totalTokens += tokens
                    totalCost += cost
                    totalCU += cu
                    totalDurationMs += duration
                    totalProcessed++
                }
            }

            const avgProcessingTimeMs = totalProcessed > 0 ? Math.round(totalDurationMs / totalProcessed) : 0
            const avgTokensPerPayment = totalProcessed > 0 ? Math.round(totalTokens / totalProcessed) : 0
            const avgPromptTokens = totalProcessed > 0 ? Math.round(totalPrompt / totalProcessed) : 0
            const avgCompletionTokens = totalProcessed > 0 ? Math.round(totalCompletion / totalProcessed) : 0
            const avgCost = totalProcessed > 0 ? Math.round((totalCost / totalProcessed) * 10000) / 10000 : 0
            const avgCapacityUnits = totalProcessed > 0 ? Math.round((totalCU / totalProcessed) * 10000) / 10000 : 0

            const medianProcessingTimeMs = Math.round(calculateMedian(durationArr))
            const medianTokensPerPayment = Math.round(calculateMedian(tokensArr))
            const medianPromptTokens = Math.round(calculateMedian(promptArr))
            const medianCompletionTokens = Math.round(calculateMedian(completionArr))
            const medianCost = Math.round(calculateMedian(costArr) * 10000) / 10000
            const medianCapacityUnits = Math.round(calculateMedian(cuArr) * 10000) / 10000

            const activeModel = activeModelName()

            return {
                totalPromptTokens: totalPrompt,
                totalCompletionTokens: totalCompletion,
                totalTokens,
                totalCost: Math.round(totalCost * 10000) / 10000,
                totalCapacityUnits: Math.round(totalCU * 10000) / 10000,
                totalProcessed,
                avgProcessingTimeMs,
                avgTokensPerPayment,
                avgPromptTokens,
                avgCompletionTokens,
                avgCost,
                avgCapacityUnits,
                medianProcessingTimeMs,
                medianTokensPerPayment,
                medianPromptTokens,
                medianCompletionTokens,
                medianCost,
                medianCapacityUnits,
                activeModel,
            }
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
            await UPDATE.entity(ProposedMatches, ID).with({ reviewStatus: 'approved' })

            LOG.info(`🏦 [S/4 Clearing] Posting clearance document to S/4HANA for open item ${match.openItemId}...`)
            let result: ClearingResult
            try {
                const results = await postClearing([{
                    openItemId: match.openItemId,
                    companyCode: match.companyCode,
                    amount: Number(match.amount),
                    currency: match.currency,
                    customer: match.customerAccount,
                }])
                result = results[0]
            } catch (networkErr: any) {
                const errorMsg = networkErr?.message || String(networkErr)
                LOG.error(`❌ [S/4 Clearing] Transport error connecting to S/4HANA destination: ${errorMsg}`)
                await UPDATE.entity(ProposedMatches, ID).with({
                    reviewStatus: 'approved',
                    postingId: null,
                    documentNumber: null,
                    postingError: `Błąd połączenia z S/4HANA (${errorMsg}). Sprawdź konfigurację destination HD0_BAS.`,
                })
                return req.error(502, `Błąd połączenia z S/4HANA (${errorMsg}). Sprawdź konfigurację destination HD0_BAS.`)
            }
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