import cds from '@sap/cds'
import type { Request } from '@sap/cds'
import { randomUUID } from 'node:crypto'
import type { ingestAgentMatch, processPaymentDocument } from '../@cds-models/CashSyncService/index.js'
import { extractPayment } from './agents/extraction-agent.js'
import {
    aggregateOpenItemAssessment,
    allocatePaymentAmount,
    applyScoreGuardrails,
    buildMatchingPrompt,
    checkExactMatch,
    heuristicFallbackScores,
    parseAiMatchingResponse,
    selectAiCandidates,
    toCandidate,
} from './agents/open-item-assessment.js'
import type {
    AiMatchingResponse,
    AssessableOpenItem,
    AssessablePayment,
    OpenItemMatchEvidence,
    ScoredCandidate,
} from './agents/open-item-assessment.js'
import { fetchNewPdfMailboxMessages } from './connectors/mailbox-client.js'
import { getOpenItems as getLiveOpenItems } from './s4/open-items-client.js'
import { postClearing, type SapMessage, type ClearingResult } from './s4/clearing-client.js'
import { activeModelName, calculateTokenCost, calculateCapacityUnits } from './genai/index.js'
import type { TokenUsage } from './genai/index.js'
import {
    PAYMENT_STATUS,
    PROPOSED_MATCH_STATUS,
    MATCH_RESULT_STATUS,
    REVIEW_STATUS,
    CONFIDENCE_THRESHOLDS,
    INGESTION_SOURCE,
    CLASSIFICATION_DECISION,
    INGESTION_PROCESSING_STATUS,
    OPEN_ITEM_CLEARING_STATUS,
    MATCH_STATUS,
} from './constants/index.js'
import { ApplicationError } from './core/errors/ApplicationError.js'
import { paymentsRepository } from './repository/index.js'

// Below this extractionConfidence the Matching Agent is skipped entirely
// rather than run on shaky data, and the payment goes straight to needsReview.
// 0.6 mirrors the reference ts-agentic-poc policy; revisit with usage data.
export const LOW_CONFIDENCE_THRESHOLD = CONFIDENCE_THRESHOLDS.LOW

const { INSERT, UPDATE, SELECT } = cds.ql
const LOG = cds.log('cash-service')
type ProcessPaymentDocumentPayload = Parameters<typeof processPaymentDocument>[0]
type IngestAgentMatchPayload = Parameters<typeof ingestAgentMatch>[0]


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
            let matchStatus: string = MATCH_RESULT_STATUS.NEEDS_REVIEW
            let reviewStatus: string = REVIEW_STATUS.PENDING
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
                matchStatus = parsed.match_status || (confidence >= CONFIDENCE_THRESHOLDS.AI_EVALUATION ? MATCH_RESULT_STATUS.MATCHED : MATCH_RESULT_STATUS.NEEDS_REVIEW)
                reviewStatus = parsed.review_status || (matchStatus === MATCH_RESULT_STATUS.MATCHED ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.PENDING)
                actionRequired = typeof parsed.action_required === 'boolean' ? parsed.action_required : matchStatus !== MATCH_RESULT_STATUS.MATCHED
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
            req.notify('AI_ANALYSIS_COMPLETED', undefined, [String(matchId), String(matchStatus), (confidence * 100).toFixed(0)])
            return SELECT.one.from(DbMatchResult, matchId)
        })

        // 2. Manual operator approval from the UI
        this.on('manualApprove', 'MatchResult', async (req: Request) => {
            const first = req.params[0] as { match_id?: string } | string | undefined
            const matchId = typeof first === 'object' ? (first?.match_id ?? first) : first

            LOG.info(`[Operator Action] Manual approval triggered for MatchResult ID: ${matchId}`)

            await UPDATE.entity(DbMatchResult)
                .set({
                    match_status: MATCH_RESULT_STATUS.MATCHED,
                    action_required: false,
                    review_status: REVIEW_STATUS.APPROVED,
                    review_reason: 'Ręcznie zatwierdzone przez operatora'
                })
                .where({ match_id: matchId })

            LOG.info(`[Operator Action] MatchResult ${matchId} updated -> Status: MATCHED, Review: APPROVED`)
            req.notify('MANUAL_APPROVE_COMPLETED', undefined, [String(matchId)])
            return SELECT.one.from(DbMatchResult, matchId)
        })

        // 2. Webhook / Action for external match ingestion
        this.on('ingestAgentMatch', async (req: Request) => {
            const { match_id, open_item_id, matched_amount, confidence, review_reason } = req.data as IngestAgentMatchPayload
            const matchStatus = Number(confidence) > CONFIDENCE_THRESHOLDS.AGENT_MATCH ? MATCH_RESULT_STATUS.MATCHED : MATCH_RESULT_STATUS.NEEDS_REVIEW

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

        // 4. Three-agent pipeline (shared by startup, syncMailbox, revalidatePipeline,
        // uploads and reprocessWithAI):
        //   Step 0  S/4HANA  — all open AND cleared open items are UPSERTed into the
        //                      local cache (AI assessment columns survive the sync).
        //   Agent 1 Mail     — downloads only new mails that carry a PDF.
        //   Agent 2 Extract  — PDF + subject/sender -> one Payments row per PDF.
        //   Agent 3 Match    — deterministic 100 % check, otherwise AI score 0–99 %,
        //                      then every OPEN item gets an aggregated "is it paid" assessment.
        // Payments come only from mails/uploads; S/4 is read for open items and
        // written only when an operator posts an approved clearing.
        const toAssessableOpenItem = (row: Record<string, unknown>): AssessableOpenItem => ({
            openItemId: String(row.OpenItemId ?? ''),
            companyCode: String(row.CompanyCode ?? ''),
            customerAccount: String(row.CustomerAccount ?? ''),
            customerName: String(row.CustomerName ?? ''),
            invoiceAmount: Number(row.InvoiceAmount ?? 0),
            invoiceAmountCurrency: String(row.InvoiceAmountCurr ?? ''),
            clearingStatus: String(row.ClearingStatus ?? OPEN_ITEM_CLEARING_STATUS.OPEN),
        })

        const loadOpenItems = async (): Promise<AssessableOpenItem[]> => {
            try {
                const liveItems = await getLiveOpenItems()
                const rows = liveItems.map(item => ({
                    OpenItemId: item.openItemId,
                    CompanyCode: item.companyCode,
                    CustomerAccount: item.customerAccount,
                    CustomerName: item.customerName,
                    InvoiceAmount: item.invoiceAmount,
                    InvoiceAmountCurr: item.invoiceAmountCurrency,
                    ClearingStatus: item.clearingStatus === OPEN_ITEM_CLEARING_STATUS.CLEARED
                        ? OPEN_ITEM_CLEARING_STATUS.CLEARED
                        : OPEN_ITEM_CLEARING_STATUS.OPEN,
                    PostingDate: item.postingDate,
                    DocumentDate: item.documentDate,
                }))
                await paymentsRepository.upsertOpenItems(rows)
                await paymentsRepository.deleteOpenItemsNotIn(rows.map(row => row.OpenItemId))
                const cleared = rows.filter(row => row.ClearingStatus === OPEN_ITEM_CLEARING_STATUS.CLEARED).length
                LOG.info('[ERP Sync] Open items synchronized from S/4HANA', { total: rows.length, open: rows.length - cleared, cleared })
                return rows.map(toAssessableOpenItem)
            } catch (err) {
                const rows = await paymentsRepository.findAllCachedOpenItems() as Array<Record<string, unknown>>
                LOG.warn('[ERP Sync] S/4HANA unreachable, using cached open items', { error: (err as Error).message, cached: rows.length })
                return rows.map(toAssessableOpenItem)
            }
        }

        type ProviderModule = Awaited<ReturnType<typeof resolveProvider>>
        interface TextResult { content: string; usage?: TokenUsage; model?: string }

        const callText = async (provider: ProviderModule, prompt: string): Promise<TextResult> => {
            const withUsage = (provider as { generateTextWithUsage?: (p: string) => Promise<TextResult> }).generateTextWithUsage
            if (typeof withUsage === 'function') return withUsage(prompt)
            return { content: await provider.generateText(prompt) }
        }

        const parseReferences = (value: unknown): string[] => {
            if (Array.isArray(value)) return value.map(String).filter(Boolean)
            if (typeof value === 'string' && value.trim()) {
                try {
                    const parsed = JSON.parse(value)
                    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [value]
                } catch {
                    return [value]
                }
            }
            return []
        }

        const toBuffer = async (content: unknown): Promise<Buffer> => {
            if (!content) return Buffer.alloc(0)
            if (Buffer.isBuffer(content)) return content
            if (typeof content === 'string') return Buffer.from(content, 'base64')
            if (typeof (content as any)[Symbol.asyncIterator] === 'function' || typeof (content as any).on === 'function') {
                const chunks: Buffer[] = []
                for await (const chunk of (content as any)) {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
                }
                return Buffer.concat(chunks)
            }
            return Buffer.alloc(0)
        }

        const mapWithConcurrency = async <T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> => {
            const results: R[] = new Array(items.length)
            let next = 0
            const worker = async () => {
                while (next < items.length) {
                    const index = next++
                    results[index] = await task(items[index])
                }
            }
            await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
            return results
        }

        const AGENT_CONCURRENCY = 3

        // Agent 1: new mails with a PDF -> IngestionLog rows (status received).
        const runMailIntakeAgent = async (): Promise<Array<Record<string, unknown>>> => {
            const messages = await fetchNewPdfMailboxMessages(messageId => paymentsRepository.hasLoggedMessage(messageId))
            const created: Array<Record<string, unknown>> = []
            for (const message of messages) {
                for (const attachment of message.attachments) {
                    const entry = {
                        ID: randomUUID(),
                        timestamp: new Date().toISOString(),
                        source: INGESTION_SOURCE.MAILBOX,
                        messageId: message.messageId,
                        sender: message.from,
                        subject: message.subject,
                        filename: attachment.filename,
                        bodyText: message.bodyText,
                        classificationDecision: CLASSIFICATION_DECISION.RELEVANT,
                        classificationReason: 'Mail z załącznikiem PDF — przekazany do ekstrakcji.',
                        processingStatus: INGESTION_PROCESSING_STATUS.RECEIVED,
                    }
                    await paymentsRepository.insertIngestionLog({ ...entry, attachmentContent: attachment.content })
                    created.push(entry)
                }
            }
            LOG.info('[Agent 1: Mail intake] Completed', { newMails: messages.length, newPdfs: created.length })
            return created
        }

        interface ExtractionOutcome {
            paymentId: string
            status: string
            processingTimeMs: number
        }

        // Agent 2: PDF (+ mail subject/sender) -> Payments row. Low-confidence or
        // zero-amount extractions go to needsReview and are not matched.
        const runExtractionAgent = async (
            pdf: Buffer,
            provider: ProviderModule,
            source: { fileName?: string | null; emailSubject?: string | null; sender?: string | null; existingPaymentId?: string | null },
        ): Promise<ExtractionOutcome> => {
            const tStart = Date.now()
            const paymentId = source.existingPaymentId || randomUUID()
            const extractFn = (provider as any).extractDocumentWithUsage || provider.extractDocument
            let record: Record<string, unknown>
            let status: string
            try {
                const payment = await extractPayment(pdf, extractFn, {
                    emailSubject: source.emailSubject ?? undefined,
                    sender: source.sender ?? undefined,
                })
                const confidence = Number(payment.extractionConfidence ?? 0)
                const usable = confidence >= LOW_CONFIDENCE_THRESHOLD && Number(payment.amount) > 0
                status = usable ? PAYMENT_STATUS.EXTRACTED : PAYMENT_STATUS.NEEDS_REVIEW
                const model = payment.aiModel || activeModelName()
                const hasUsage = payment.totalTokens != null || payment.promptTokens != null
                const promptTokens = Number(payment.promptTokens ?? 0)
                const completionTokens = Number(payment.completionTokens ?? 0)
                record = {
                    payer: payment.payer,
                    companyCode: payment.companyCode || null,
                    amount: payment.amount,
                    currency: payment.currency,
                    valueDate: payment.valueDate,
                    references: payment.references,
                    extractionConfidence: confidence,
                    status,
                    rationale: usable
                        ? 'Dane wyodrębnione z awizo — oczekuje na dopasowanie.'
                        : `Niska pewność ekstrakcji (${Math.round(confidence * 100)}%) lub brak kwoty — dopasowanie pominięte, wymagana weryfikacja ręczna.`,
                    promptTokens: hasUsage ? promptTokens : null,
                    completionTokens: hasUsage ? completionTokens : null,
                    totalTokens: hasUsage ? Number(payment.totalTokens ?? promptTokens + completionTokens) : null,
                    estimatedCost: hasUsage ? calculateTokenCost(model, promptTokens, completionTokens) : null,
                    capacityUnits: hasUsage ? calculateCapacityUnits(model, promptTokens, completionTokens) : null,
                    aiModel: model,
                }
            } catch (err) {
                status = PAYMENT_STATUS.FAILED
                record = {
                    payer: source.sender || 'Nieznany płatnik',
                    amount: 0,
                    currency: 'EUR',
                    references: [],
                    extractionConfidence: 0,
                    status,
                    rationale: `Ekstrakcja nie powiodła się: ${(err as Error).message}`,
                    aiModel: activeModelName(),
                }
                LOG.warn('[Agent 2: Extraction] Failed', { fileName: source.fileName, error: (err as Error).message })
            }
            const processingTimeMs = Date.now() - tStart
            record.processingTimeMs = processingTimeMs
            record.fileName = source.fileName || null
            if (source.existingPaymentId && await paymentsRepository.findPaymentById(paymentId)) {
                await paymentsRepository.updatePayment(paymentId, record)
            } else {
                await paymentsRepository.insertPayment({ ID: paymentId, ...record, attachmentContent: pdf })
            }
            LOG.info('[Agent 2: Extraction] Payment stored', { paymentId, status, payer: record.payer, amount: record.amount, currency: record.currency, processingTimeMs })
            return { paymentId, status, processingTimeMs }
        }

        interface MatchingOutcome {
            status: string
            candidates: ScoredCandidate[]
            bestScore: number
            rationale: string
        }

        // Agent 3a: one payment against all open items.
        const runMatchingAgent = async (
            paymentRow: Record<string, any>,
            openItems: AssessableOpenItem[],
            provider: ProviderModule,
            options: { emailSubject?: string | null; emailBody?: string | null; baseProcessingMs?: number } = {},
        ): Promise<MatchingOutcome> => {
            const tStart = Date.now()
            const paymentId = String(paymentRow.ID)
            const payment: AssessablePayment = {
                payer: String(paymentRow.payer ?? ''),
                companyCode: paymentRow.companyCode ?? null,
                amount: Number(paymentRow.amount ?? 0),
                currency: String(paymentRow.currency ?? ''),
                valueDate: paymentRow.valueDate ?? null,
                references: parseReferences(paymentRow.references),
            }

            // Human decisions (approved / rejected / posted) are kept and their
            // open items are not proposed again for this payment.
            const existing = await paymentsRepository.findMatchesByPaymentId(paymentId) as Array<Record<string, any>>
            const decided = new Set(existing
                .filter(m => m.openItemId && m.reviewStatus !== PROPOSED_MATCH_STATUS.PENDING)
                .map(m => String(m.openItemId)))
            const pool = openItems.filter(item => !decided.has(item.openItemId))
            const byId = new Map(pool.map(item => [item.openItemId, item]))

            let candidates: ScoredCandidate[] = []
            let rationale: string
            let usage: TokenUsage | undefined
            let usedModel: string | undefined
            let deterministic = false

            const exact = checkExactMatch(payment, pool)
            if (exact.matched) {
                deterministic = true
                candidates = exact.candidates
                rationale = candidates[0].rationale
            } else {
                const problems = exact.problems.join('; ')
                const aiPool = selectAiCandidates(payment, pool)
                let ai: AiMatchingResponse | null = null
                if (aiPool.length > 0) {
                    try {
                        const result = await callText(provider, buildMatchingPrompt(payment, aiPool, {
                            emailSubject: options.emailSubject,
                            emailBody: options.emailBody,
                            problems: exact.problems,
                        }))
                        usage = result.usage
                        usedModel = result.model
                        ai = parseAiMatchingResponse(result.content, aiPool.map(item => item.openItemId))
                        if (!ai) LOG.warn('[Agent 3: Matching] AI answer not in expected format, using rule-based scoring', { paymentId })
                    } catch (err) {
                        LOG.warn('[Agent 3: Matching] AI call failed, using rule-based scoring', { paymentId, error: (err as Error).message })
                    }
                }
                if (ai) {
                    candidates = ai.matches
                        .map(match => {
                            const item = byId.get(match.openItemId)!
                            const score = applyScoreGuardrails(payment, item, match.confidence)
                            return toCandidate(item, score, match.reason || ai!.rationale)
                        })
                        .filter(candidate => candidate.matchScore > 0)
                    rationale = ai.rationale || `Ocena AI. Rozbieżności: ${problems}.`
                } else {
                    const scores = heuristicFallbackScores(payment, pool)
                    candidates = [...scores.entries()]
                        .sort((a, b) => b[1].score - a[1].score)
                        .slice(0, 5)
                        .map(([id, score]) => toCandidate(byId.get(id)!, score.score, score.reason))
                    rationale = `Ocena regułowa (bez AI). Rozbieżności: ${problems}.`
                }
                if (candidates.length === 0) rationale = `Brak pasującej pozycji otwartej w S/4HANA. Rozbieżności: ${problems}.`
            }

            const bestScore = candidates.reduce((best, candidate) => Math.max(best, candidate.matchScore), 0)
            const status = deterministic || bestScore >= CONFIDENCE_THRESHOLDS.AI_EVALUATION
                ? PAYMENT_STATUS.MATCHED
                : PAYMENT_STATUS.NEEDS_REVIEW

            await paymentsRepository.deleteReplaceableMatchesByPaymentId(paymentId)
            await paymentsRepository.insertProposedMatches(candidates.map(candidate => ({
                payment_ID: paymentId,
                openItemId: candidate.openItemId,
                companyCode: candidate.companyCode,
                customerAccount: candidate.customerAccount,
                amount: candidate.amount,
                currency: candidate.currency,
                matchStatus: candidate.matchStatus,
                matchScore: candidate.matchScore,
                reviewStatus: PROPOSED_MATCH_STATUS.PENDING,
                rationale: candidate.rationale,
            })))

            // Token analytics: real usage only, accumulated per payment (extraction + every matching run).
            const changes: Record<string, unknown> = {
                status,
                rationale,
                processingTimeMs: (options.baseProcessingMs ?? 0) + (Date.now() - tStart),
            }
            if (usage) {
                const model = usedModel || paymentRow.aiModel || activeModelName()
                const promptTokens = Number(paymentRow.promptTokens ?? 0) + usage.promptTokens
                const completionTokens = Number(paymentRow.completionTokens ?? 0) + usage.completionTokens
                Object.assign(changes, {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    estimatedCost: calculateTokenCost(model, promptTokens, completionTokens),
                    capacityUnits: calculateCapacityUnits(model, promptTokens, completionTokens),
                    aiModel: model,
                })
            }
            await paymentsRepository.updatePayment(paymentId, changes)
            LOG.info('[Agent 3: Matching] Payment evaluated', {
                paymentId,
                payer: payment.payer,
                deterministic,
                status,
                bestScore,
                candidates: candidates.map(c => `${c.openItemId}:${c.matchScore}`),
            })
            return { status, candidates, bestScore, rationale }
        }

        // Agent 3b: per OPEN item, how sure are we that it is paid (all payments combined).
        const assessOpenItems = async (): Promise<number> => {
            const [items, matches, payments] = await Promise.all([
                paymentsRepository.findOpenItemsByStatus(OPEN_ITEM_CLEARING_STATUS.OPEN) as Promise<Array<Record<string, unknown>>>,
                paymentsRepository.findAllProposedMatches() as Promise<Array<Record<string, any>>>,
                paymentsRepository.findAllPayments(['ID', 'payer', 'amount', 'currency', 'status']) as Promise<Array<Record<string, any>>>,
            ])
            const paymentById = new Map(payments.map(p => [String(p.ID), p]))
            const matchesByPayment = new Map<string, Array<Record<string, any>>>()
            for (const match of matches) {
                if (!match.openItemId || match.reviewStatus === PROPOSED_MATCH_STATUS.REJECTED || Number(match.matchScore) <= 0) continue
                const list = matchesByPayment.get(match.payment_ID) ?? []
                list.push(match)
                matchesByPayment.set(match.payment_ID, list)
            }

            const evidenceByItem = new Map<string, OpenItemMatchEvidence[]>()
            for (const [paymentId, list] of matchesByPayment) {
                const payment = paymentById.get(paymentId)
                if (!payment || payment.status === PAYMENT_STATUS.FAILED) continue
                const itemAmounts = list.map(m => Number(m.amount ?? 0))
                for (const match of list) {
                    const evidence = evidenceByItem.get(match.openItemId) ?? []
                    evidence.push({
                        payer: String(payment.payer ?? ''),
                        paymentAmount: Number(payment.amount ?? 0),
                        allocatedAmount: allocatePaymentAmount(Number(payment.amount ?? 0), Number(match.amount ?? 0), itemAmounts),
                        currency: String(payment.currency ?? ''),
                        matchScore: Number(match.matchScore ?? 0),
                        matchStatus: String(match.matchStatus ?? ''),
                        rationale: String(match.rationale ?? ''),
                    })
                    evidenceByItem.set(match.openItemId, evidence)
                }
            }

            const assessedAt = new Date().toISOString()
            for (const row of items) {
                const item = toAssessableOpenItem(row)
                const assessment = aggregateOpenItemAssessment(item, evidenceByItem.get(item.openItemId) ?? [])
                await paymentsRepository.updateOpenItemAssessment(item.openItemId, { ...assessment, assessedAt })
            }
            LOG.info('[Agent 3: Assessment] Open items assessed', { openItems: items.length, withEvidence: evidenceByItem.size })
            return items.length
        }

        const emailContextForPayment = async (paymentId: string) => {
            const [log] = await paymentsRepository.findIngestionLogsByPaymentId(paymentId) as Array<Record<string, any>>
            return { emailSubject: log?.subject ?? null, emailBody: log?.bodyText ?? null }
        }

        interface PipelineSummary {
            openItems: number
            newLogs: Array<Record<string, unknown>>
            extracted: number
            failed: number
            evaluated: number
            matched: number
            review: number
        }

        // full=false: new mails only (startup, syncMailbox, scheduler).
        // full=true:  also retries failed extractions and re-matches every unposted payment.
        const runAgentPipeline = async ({ full }: { full: boolean }): Promise<PipelineSummary> => {
            const tStart = Date.now()
            LOG.info('[Pipeline] Started', { mode: full ? 'full' : 'incremental', engine: providerMode() })
            const provider = await resolveProvider()

            const openItems = await loadOpenItems()

            let newLogs: Array<Record<string, unknown>> = []
            try {
                newLogs = await runMailIntakeAgent()
            } catch (err) {
                LOG.warn('[Agent 1: Mail intake] Mailbox unavailable', { error: (err as Error).message })
            }

            const logs = [
                ...await paymentsRepository.findPendingIngestionLogs() as Array<Record<string, any>>,
                ...(full ? await paymentsRepository.findFailedIngestionLogs() as Array<Record<string, any>> : []),
            ]
            const extractionMs = new Map<string, number>()
            let failed = 0
            await mapWithConcurrency(logs, AGENT_CONCURRENCY, async (log) => {
                const pdf = await toBuffer(log.attachmentContent)
                if (pdf.length === 0) {
                    failed++
                    await paymentsRepository.updateIngestionLog(log.ID, {
                        processingStatus: INGESTION_PROCESSING_STATUS.FAILED,
                        classificationReason: 'Pusty załącznik PDF.',
                    })
                    return
                }
                const outcome = await runExtractionAgent(pdf, provider, {
                    fileName: log.filename,
                    emailSubject: log.subject,
                    sender: log.sender,
                    existingPaymentId: log.payment_ID,
                })
                extractionMs.set(outcome.paymentId, outcome.processingTimeMs)
                if (outcome.status === PAYMENT_STATUS.FAILED) failed++
                await paymentsRepository.updateIngestionLog(log.ID, {
                    payment_ID: outcome.paymentId,
                    processingStatus: outcome.status === PAYMENT_STATUS.FAILED
                        ? INGESTION_PROCESSING_STATUS.FAILED
                        : INGESTION_PROCESSING_STATUS.EXTRACTED,
                })
            })

            const statuses: string[] = full
                ? [PAYMENT_STATUS.EXTRACTED, PAYMENT_STATUS.MATCHED, PAYMENT_STATUS.NEEDS_REVIEW]
                : [PAYMENT_STATUS.EXTRACTED]
            const candidates = (await paymentsRepository.findAllPayments() as Array<Record<string, any>>)
                .filter(p => statuses.includes(p.status))
                // Unreliable extractions stay in review; matching them would only produce noise.
                .filter(p => Number(p.extractionConfidence ?? 0) >= LOW_CONFIDENCE_THRESHOLD && Number(p.amount ?? 0) > 0)
            const outcomes = await mapWithConcurrency(candidates, AGENT_CONCURRENCY, async (payment) => {
                const context = await emailContextForPayment(payment.ID)
                return runMatchingAgent(payment, openItems, provider, { ...context, baseProcessingMs: extractionMs.get(payment.ID) })
            })
            await assessOpenItems()

            const summary: PipelineSummary = {
                openItems: openItems.length,
                newLogs,
                extracted: logs.length - failed,
                failed,
                evaluated: outcomes.length,
                matched: outcomes.filter(o => o.status === PAYMENT_STATUS.MATCHED).length,
                review: outcomes.filter(o => o.status === PAYMENT_STATUS.NEEDS_REVIEW).length,
            }
            LOG.info('[Pipeline] Completed', { mode: full ? 'full' : 'incremental', durationMs: Date.now() - tStart, ...summary, newLogs: newLogs.length })
            return summary
        }

        // One pipeline run at a time across startup, scheduler and UI actions.
        let activePipeline: Promise<PipelineSummary> | null = null
        const startPipeline = (full: boolean): Promise<PipelineSummary> | null => {
            if (activePipeline) return null
            activePipeline = runAgentPipeline({ full }).finally(() => { activePipeline = null })
            return activePipeline
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

        // Manual upload = Agent 2 + Agent 3 for a single PDF (no mailbox step).
        const processUploadedPdf = (pdf: Buffer, fileName?: string) => queueProcessing(async () => {
            const provider = await resolveProvider()
            const openItems = await loadOpenItems()
            const extraction = await runExtractionAgent(pdf, provider, { fileName })
            let matchCount = 0
            if (extraction.status === PAYMENT_STATUS.EXTRACTED) {
                const payment = await paymentsRepository.findPaymentById(extraction.paymentId)
                const outcome = await runMatchingAgent(payment as Record<string, any>, openItems, provider, { baseProcessingMs: extraction.processingTimeMs })
                matchCount = outcome.candidates.length
            }
            await assessOpenItems()
            return { paymentId: extraction.paymentId, matchCount }
        })

        this.on('processPaymentDocument', async (req: Request) => {
            const { pdfBase64 } = req.data as ProcessPaymentDocumentPayload
            if (!pdfBase64) return req.error({ code: '400', message: 'pdfBase64 is required' })
            const { paymentId, matchCount } = await processUploadedPdf(Buffer.from(pdfBase64, 'base64'))
            return `Stored ${matchCount} proposed match(es) for payment ${paymentId}`
        })

        // Manual-upload entry point: raw PDF bytes in, stored Payment row out.
        this.on('uploadPayment', async (req: Request) => {
            const { fileName, fileContent } = req.data as { fileName: string; fileContent: unknown }
            let pdf: Buffer
            try {
                pdf = decodeFileContent(fileContent)
            } catch (err) {
                LOG.error('[Upload] Could not decode file content', { fileName, error: (err as Error).message })
                return req.error(400, `Could not decode fileContent for "${fileName}": ${(err as Error).message}`)
            }
            const { paymentId } = await processUploadedPdf(pdf, fileName)
            return SELECT.one.from(this.entities.Payments, paymentId)
        })

        // Incremental run: Agent 1 (new PDF mails) -> Agent 2 -> Agent 3.
        this.on('syncMailbox', async (req: Request) => {
            const run = startPipeline(false)
            if (!run) return req.reject(409, 'PIPELINE_BUSY')
            try {
                const summary = await run
                if (summary.newLogs.length > 0) req.notify('SYNC_MAILBOX_SUCCESS', undefined, [summary.newLogs.length])
                else req.notify('SYNC_MAILBOX_NO_NEW')
                return summary.newLogs
            } catch (err) {
                LOG.error('[Mailbox Sync] Failed', { error: (err as Error).message })
                return req.reject(500, `Mailbox synchronization failed: ${(err as Error).message}`)
            }
        })

        // Full run: S/4 resync, retry failed extractions, re-match every unposted payment.
        this.on('revalidatePipeline', async (req: Request) => {
            const run = startPipeline(true)
            if (!run) return req.reject(409, 'PIPELINE_BUSY')
            try {
                const summary = await run
                req.notify('REVALIDATE_PIPELINE_SUCCESS', undefined, [String(summary.evaluated), String(summary.openItems), String(summary.matched), String(summary.review)])
                return `Pipeline revalidated: ${summary.evaluated} payment(s) evaluated against ${summary.openItems} ERP open item(s) (${summary.matched} auto-matched, ${summary.review} pending review).`
            } catch (err) {
                LOG.error('[Pipeline] Revalidation failed', { error: (err as Error).message })
                return req.reject(500, `Pipeline revalidation failed: ${(err as Error).message}`)
            }
        })

        // Operator action: Agent 3 for one payment, then open-item re-assessment.
        this.on('reprocessWithAI', 'Payments', async (req: Request) => {
            const [{ ID }] = req.params as [{ ID: string }]
            const payment = await paymentsRepository.findPaymentById(ID) as Record<string, any> | undefined
            if (!payment) return req.error(404, `Payment ${ID} not found.`)
            if (payment.status === PAYMENT_STATUS.POSTED || payment.status === PAYMENT_STATUS.CLEARED) {
                return req.error(400, 'PAYMENT_ALREADY_POSTED', undefined, [payment.payer])
            }

            const provider = await resolveProvider()
            const openItems = await loadOpenItems()
            const outcome = await runMatchingAgent(payment, openItems, provider, await emailContextForPayment(ID))
            await assessOpenItems()

            const score = outcome.bestScore.toFixed(2)
            if (outcome.candidates.length > 0) {
                req.notify('AI_REVALIDATION_MATCHED', undefined, [payment.payer, score, outcome.status, outcome.candidates.length, outcome.candidates.map(c => c.openItemId).join(', ')])
            } else {
                req.notify('AI_REVALIDATION_NO_MATCH', undefined, [payment.payer, score, outcome.status])
            }
            return SELECT.one.from(this.entities.Payments, ID)
        })

        // Operator action: manually posts a validated payment to S/4HANA clearing.
        this.on('postToS4', 'Payments', async (req: Request) => {
            const { Payments, ProposedMatches } = cds.entities('poc.cashapp')
            const [{ ID }] = req.params as [{ ID: string }]
            const payment = await SELECT.one.from(Payments, ID)
            if (!payment) return req.error(404, `Payment ${ID} not found.`)

            LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            LOG.info(`🏦 [Manual Post] Operator triggered S/4HANA posting for payment ${ID} (${payment.payer}, ${payment.amount} ${payment.currency})`)

            if (payment.status === PAYMENT_STATUS.POSTED || payment.status === PAYMENT_STATUS.CLEARED) {
                return req.error(400, `Płatność dla ${payment.payer} została już wcześniej zaksięgowana w S/4HANA.`)
            }

            const matches = await paymentsRepository.findMatchesByPaymentId(ID)
            const validMatches = (matches as any[]).filter((m: any) => m.openItemId && m.openItemId !== '(brak dopasowania)' && m.openItemId !== '')

            if (validMatches.length === 0) {
                LOG.warn(`[Manual Post] No valid open item associated with payment ${ID}.`)
                return req.error(400, `Płatność (${payment.payer}) nie posiada powiązanej otwartej pozycji w SAP. Dopasuj pozycję przed zaksięgowaniem.`)
            }

            const unpostedMatches = validMatches.filter((m: any) =>
                m.reviewStatus !== PROPOSED_MATCH_STATUS.POSTED && m.reviewStatus !== PROPOSED_MATCH_STATUS.REJECTED)
            if (unpostedMatches.length === 0) {
                return req.error(400, 'PAYMENT_ALREADY_POSTED', undefined, [payment.payer])
            }
            // Low-score AI suggestions (toBeChecked) are posted only after an operator approves them.
            const pendingMatches = unpostedMatches.filter((m: any) =>
                m.reviewStatus === PROPOSED_MATCH_STATUS.APPROVED
                || m.matchStatus === MATCH_STATUS.FULL
                || m.matchStatus === MATCH_STATUS.PROBABLE)
            if (pendingMatches.length === 0) {
                return req.error(400, 'PAYMENT_NO_CONFIDENT_MATCH', undefined, [payment.payer])
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
                const s4Msg = networkErr?.response?.data?.error?.message || networkErr?.cause?.response?.data?.error?.message
                const s4Code = networkErr?.response?.data?.error?.code || networkErr?.cause?.response?.data?.error?.code
                const errorMsg = s4Msg ? `${s4Code ? `[${s4Code}] ` : ''}${typeof s4Msg === 'string' ? s4Msg : s4Msg.value || JSON.stringify(s4Msg)}` : (networkErr?.message || String(networkErr))
                LOG.error(`❌ [S/4 Clearing] S/4HANA Destination/Connectivity error: ${errorMsg}`)
                for (const m of pendingMatches) {
                    await UPDATE.entity(ProposedMatches, m.ID).with({
                        reviewStatus: 'approved',
                        postingId: null,
                        documentNumber: null,
                        postingError: errorMsg,
                    })
                }
                return req.error(502, 'S4_CONNECTIVITY_ERROR', undefined, [errorMsg])
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

            const clearedIds = pendingMatches
                .filter((_m: any, i: number) => results[i] && !results[i].sapMessages.some((m: SapMessage) => m.numericSeverity >= SAP_FAIL_SEVERITY))
                .map((m: any) => m.openItemId)
            await paymentsRepository.markOpenItemsCleared(clearedIds)
            await assessOpenItems()

            if (!hasFailures) {
                const remainingUnposted = (await paymentsRepository.findUnpostedMatchesByPaymentId(ID) as any[])
                    .filter((m: any) => m.reviewStatus !== PROPOSED_MATCH_STATUS.REJECTED)

                if (remainingUnposted.length === 0) {
                    await paymentsRepository.updatePayment(ID, {
                        status: PAYMENT_STATUS.POSTED,
                    })
                    LOG.info(`✅ [Manual Post] All items posted. Payment ${ID} status updated to "${PAYMENT_STATUS.POSTED}"`)
                }
                LOG.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
                req.notify('PAYMENT_POSTED_S4', undefined, [payment.payer, docNumbers.length, docNumbers.join(', ')])
                return SELECT.one.from(this.entities.Payments, ID)
            }
            else {
                LOG.warn(`⚠️ [Manual Post] Partial or complete failure during posting for payment ${ID}`)
                return req.error(502, 'S4_POSTING_PARTIAL_ERROR')
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
                const rows = (await paymentsRepository.findAllCachedOpenItems() as Array<Record<string, any>>)
                    .filter(row => !customerAccount || row.CustomerAccount === customerAccount)
                return rows.map(toAssessableOpenItem).map(item => ({
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
            const payments = await paymentsRepository.findAllPayments() as any[]
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
                const s4Msg = networkErr?.response?.data?.error?.message || networkErr?.cause?.response?.data?.error?.message
                const s4Code = networkErr?.response?.data?.error?.code || networkErr?.cause?.response?.data?.error?.code
                const errorMsg = s4Msg ? `${s4Code ? `[${s4Code}] ` : ''}${typeof s4Msg === 'string' ? s4Msg : s4Msg.value || JSON.stringify(s4Msg)}` : (networkErr?.message || String(networkErr))
                LOG.error(`❌ [S/4 Clearing] Transport error connecting to S/4HANA destination: ${errorMsg}`)
                await UPDATE.entity(ProposedMatches, ID).with({
                    reviewStatus: 'approved',
                    postingId: null,
                    documentNumber: null,
                    postingError: errorMsg,
                })
                return req.error(502, 'S4_CONNECTIVITY_ERROR', undefined, [errorMsg])
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
                    reviewStatus: PROPOSED_MATCH_STATUS.POSTED,
                    postingId: result.postingId,
                    documentNumber: result.documentNumber,
                    postingError: null,
                })
                await paymentsRepository.markOpenItemsCleared([match.openItemId])
                if (match.payment_ID) {
                    const unpostedMatches = (await paymentsRepository.findOtherUnpostedMatches(match.payment_ID, ID) as any[])
                        .filter((m: any) => m.reviewStatus !== PROPOSED_MATCH_STATUS.REJECTED)

                    if (unpostedMatches.length === 0) {
                        await paymentsRepository.updatePayment(match.payment_ID, { status: PAYMENT_STATUS.POSTED })
                        LOG.info(`✅ [Review Action] All matches posted. Payment ${match.payment_ID} status set to "${PAYMENT_STATUS.POSTED}".`)
                    } else {
                        LOG.info(`ℹ️ [Review Action] Payment ${match.payment_ID} still has ${unpostedMatches.length} unposted match(es).`)
                    }
                }
                await assessOpenItems()
            }

            return SELECT.one.from(ProposedMatches, ID)
        })

        this.on('rejectMatch', 'ProposedMatches', async (req: Request) => {
            const { ProposedMatches } = cds.entities('poc.cashapp')
            const [{ ID }] = req.params as [{ ID: string }]
            const match = await SELECT.one.from(ProposedMatches, ID)
            if (!match) {
                LOG.warn(`[Review Action] ProposedMatches ${ID} not found.`)
                throw new ApplicationError(`ProposedMatches ${ID} not found.`, 'MATCH_NOT_FOUND', 404)
            }

            LOG.info(`👤 [Review Action] Operator rejecting match ${ID} for open item ${match.openItemId}`)
            await UPDATE.entity(ProposedMatches, ID).with({ reviewStatus: PROPOSED_MATCH_STATUS.REJECTED })
            LOG.info(`✅ [Review Action] ProposedMatches ${ID} status set to "${PROPOSED_MATCH_STATUS.REJECTED}"`)
            await assessOpenItems()

            return SELECT.one.from(ProposedMatches, ID)
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

        // Startup: S/4 open-item sync + incremental agent run, in the background so
        // the server is ready immediately. AGENT_PIPELINE_ON_STARTUP=false disables it (tests).
        cds.on('served', () => {
            if (process.env.AGENT_PIPELINE_ON_STARTUP === 'false') return
            const run = startPipeline(false)
            run?.catch(err => LOG.warn('[Bootstrap] Startup pipeline failed', { error: (err as Error).message }))
        })

        return super.init()
    }
}