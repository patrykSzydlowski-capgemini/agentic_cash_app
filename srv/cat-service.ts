import cds from '@sap/cds'
import type { Request } from '@sap/cds'
import { randomUUID } from 'node:crypto'
import type { ingestAgentMatch, processPaymentDocument } from '../@cds-models/CashSyncService/index.js'
import { extractPayment } from './agents/extraction-agent.js'
import { proposeMatches } from './agents/matching-agent.js'
import type { OpenItem } from './s4/open-items-client.js'

const { INSERT, UPDATE } = cds.ql
type ProcessPaymentDocumentPayload = Parameters<typeof processPaymentDocument>[0]

// Local-first: OpenItem is served from SQLite (poc.cash.OpenItem).
// Remote SAP mock (ZAC_OPENITEMS_MOC_O4) kept in srv/external/ for reference only.
// NOTE: package.json no longer requires the remote destination, so no connect here.

/** Payload generated from the unbound CDS action. */
type IngestAgentMatchPayload = Parameters<typeof ingestAgentMatch>[0]

export default class CashSyncServiceImpl extends cds.ApplicationService {
    async init() {
        const { MatchResult: DbMatchResult } = cds.entities('poc.cash')

        this.on('triggerAIAgent', 'MatchResult', async (req: Request) => {
            const first = req.params[0] as { match_id?: string } | string | undefined
            const matchId = typeof first === 'object' ? (first?.match_id ?? first) : first

            await UPDATE.entity(DbMatchResult)
                .set({
                    match_status: 'MATCHED',
                    action_required: false,
                    review_status: 'APPROVED',
                })
                .where({ match_id: matchId })

            req.notify(`Agent AI pomyślnie przetworzył rekord ${matchId}`)
        })

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

        // Local-first pipeline: extraction -> matching -> persistence.
        // OpenRouter by default, optional SAP orchestration via CASH_AI_PROVIDER.
        // Disabled AI uses explicit local mocks, never fallback after a live error.
        this.on('processPaymentDocument', async (req: Request) => {
            const { pdfBase64 } = req.data as ProcessPaymentDocumentPayload
            if (!pdfBase64) req.error({ code: '400', message: 'pdfBase64 is required' })
            const pdfBytes = Buffer.from(pdfBase64 ?? '', 'base64')

            const provider = process.env.CASH_AI_ENABLED === 'true'
                ? await (await import('./genai/index.js')).getProvider()
                : await import('./agents/integration-mocks.js')

            const payment = await extractPayment(pdfBytes, provider.extractDocument)

            const { OpenItem: DbOpenItem } = cds.entities('poc.cash')
            const rows = await SELECT.from(DbOpenItem)
            const openItems: OpenItem[] = rows.map((row: Record<string, unknown>) => ({
                openItemId: String(row.OpenItemId),
                companyCode: String(row.CompanyCode),
                customerAccount: String(row.CustomerAccount),
                customerName: String(row.CustomerName),
                invoiceAmount: Number(row.InvoiceAmount),
                invoiceAmountCurrency: String(row.InvoiceAmountCurr),
                clearingStatus: String(row.ClearingStatus),
            }))

            const candidates = await proposeMatches(payment, openItems, provider.generateText)

            const { Payments, ProposedMatches } = cds.entities('poc.cashapp')
            // INSERT does not return the generated key back to the handler;
            // generate the cuid up front so child rows can reference it.
            const paymentId = randomUUID()
            await INSERT.into(Payments).entries({
                ID: paymentId,
                payer: payment.payer,
                amount: payment.amount,
                currency: payment.currency,
                valueDate: payment.valueDate,
                references: payment.references,
                extractionConfidence: payment.extractionConfidence,
            })
            await INSERT.into(ProposedMatches).entries(candidates.map(candidate => ({
                payment_ID: paymentId,
                openItemId: candidate.openItemId,
                companyCode: candidate.companyCode,
                matchStatus: candidate.matchStatus,
                matchScore: candidate.matchScore,
                rationale: candidate.rationale,
            })))

            return `Stored ${candidates.length} proposed match(es) for payment ${paymentId}`
        })

        return super.init()
    }
}
