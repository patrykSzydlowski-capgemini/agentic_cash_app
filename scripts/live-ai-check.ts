// Explicit live check: sends a fixture PDF to the configured provider.
// Usage: node --import tsx scripts/live-ai-check.ts
import { loadEnvFile } from 'node:process'
import { readFile } from 'node:fs/promises'
import { extractDocument, providerName, activeModelName } from '../srv/genai/index.js'
import { extractPayment } from '../srv/agents/extraction-agent.js'

try { loadEnvFile('.env') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
const pdf = await readFile('test-fixtures/remittance-samples/multi-invoice-remittance.pdf')
const t0 = Date.now()
try {
    const payment = await extractPayment(pdf, extractDocument)
    const duration = Date.now() - t0
    console.log(`Live extraction via ${providerName()} [model: ${activeModelName()}] succeeded in ${duration}ms (${(duration / 1000).toFixed(2)}s); confidence=${payment.extractionConfidence}.`)
    console.log('Extracted payment:', {
        payer: payment.payer,
        amount: `${payment.amount} ${payment.currency}`,
        valueDate: payment.valueDate,
        references: payment.references
    })
} catch (err) {
    console.error(`Live extraction failed after ${Date.now() - t0}ms. Details: ${(err as Error)?.message || err}`)
    process.exitCode = 1
}
