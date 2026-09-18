// Full-pipeline check against a running local server (npm run dev):
//   node --import tsx scripts/process-payment.ts [path/to/pdf.pdf]
// Sends the PDF to CashSyncService.processPaymentDocument and prints the
// stored payment with its proposed matches. Uses whatever the server has
// configured: live AI when CASH_AI_ENABLED=true, explicit mocks otherwise.
import { loadEnvFile } from 'node:process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE_URL = process.env.CASH_DEV_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:4004'
const pdfPath = process.argv[2] ?? 'test-fixtures/remittance-samples/multi-invoice-remittance.pdf'

try { loadEnvFile('.env') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

interface ODataError { error?: { message?: string } }
async function odata<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response
    try {
        response = await fetch(`${BASE_URL}/odata/v4/cash-sync${path}`, {
            ...init,
            headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        })
    } catch {
        throw new Error(`Cannot reach ${BASE_URL}. Start the server first (npm run dev).`)
    }
    const body = await response.json() as (T & ODataError)
    if (!response.ok) throw new Error(`OData request failed (${response.status}): ${body.error?.message ?? 'unknown error'}`)
    return body
}

const pdfBase64 = (await readFile(resolve(pdfPath))).toString('base64')
console.log(`Sending ${pdfPath} to ${BASE_URL} ...`)

const { value } = await odata<{ value: string }>('/processPaymentDocument', {
    method: 'POST',
    body: JSON.stringify({ pdfBase64 }),
})
console.log(value)

const paymentId = value.match(/payment ([0-9a-f-]{36})/i)?.[1]
if (!paymentId) throw new Error('Could not read the payment id from the server response.')

interface ProposedMatch {
    matchStatus: string
    matchScore: string
    rationale: string
}
const payment = await odata<{ payer: string; amount: string; currency: string; valueDate: string; extractionConfidence: string; matches: ProposedMatch[] }>(
    `/Payments('${paymentId}')?$expand=matches`,
)

console.log(`\nExtracted payment: ${payment.payer}, ${payment.amount} ${payment.currency}, ${payment.valueDate} (confidence ${payment.extractionConfidence})`)
if (payment.matches.length === 0) {
    console.log('No proposed matches were stored.')
} else {
    for (const match of payment.matches) {
        console.log(`- [${match.matchStatus}] score=${match.matchScore} — ${match.rationale}`)
    }
    console.log(`\nView in the UI or at ${BASE_URL}/odata/v4/cash-sync/Payments('${paymentId}')?$expand=matches`)
}
