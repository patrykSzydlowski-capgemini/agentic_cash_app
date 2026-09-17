import cds from '@sap/cds'
import type { Request } from '@sap/cds'
import { randomUUID } from 'node:crypto'
import axios from 'axios'
import type { ingestAgentMatch, processPaymentDocument } from '../@cds-models/CashSyncService/index.js'
import { extractPayment } from './agents/extraction-agent.js'
import { proposeMatches } from './agents/matching-agent.js'
import type { OpenItem } from './s4/open-items-client.js'

const { INSERT, UPDATE, SELECT, UPSERT } = cds.ql
type ProcessPaymentDocumentPayload = Parameters<typeof processPaymentDocument>[0]
type IngestAgentMatchPayload = Parameters<typeof ingestAgentMatch>[0]

interface AgentResponse {
    confidence: number
    review_required: boolean
    reason: string
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

        // 4. Local-first pipeline: processing payment document
        this.on('processPaymentDocument', async (req: Request) => {
            const { pdfBase64 } = req.data as ProcessPaymentDocumentPayload
            if (!pdfBase64) req.error({ code: '400', message: 'pdfBase64 is required' })
            const pdfBytes = Buffer.from(pdfBase64 ?? '', 'base64')

            const live = process.env.CASH_AI_ENABLED === 'true'
            const extract: (pdf: Buffer, prompt: string) => Promise<string> = live
                ? (await import('./genai/orchestration-client.js')).extractDocument
                : (await import('./agents/integration-mocks.js')).extractDocument
            const complete: (prompt: string) => Promise<string> = live
                ? (await import('./genai/orchestration-client.js')).generateText
                : (await import('./agents/integration-mocks.js')).generateText

            const payment = await extractPayment(pdfBytes, extract)

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

            const candidates = await proposeMatches(payment, openItems, complete)

            const { Payments, ProposedMatches } = cds.entities('poc.cashapp')
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

    /** Helper method to call the Agent API with fallback support */
    private async callAgentAPI(openItemData: { OpenItemId: string, CustomerName: string, InvoiceAmount: number }, bankStatementText: string): Promise<AgentResponse> {
        const apiKey = process.env.GEMINI_API_KEY

        if (!apiKey) {
            console.warn('No API key in environment. Using simulation...')
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
            console.error('API call error:', error.response?.data || error.message)
            return {
                confidence: 0.0,
                review_required: true,
                reason: 'Connection error with the analytics module.'
            }
        }
    }
}