// Explicit live check: sends a fixture PDF to the configured provider.
// Usage: node --import tsx scripts/live-ai-check.ts
import { loadEnvFile } from 'node:process'
import { readFile } from 'node:fs/promises'
import { extractDocument, providerName } from '../srv/genai/index.js'
import { extractPayment } from '../srv/agents/extraction-agent.js'

try { loadEnvFile('.env') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
if (process.env.CASH_AI_ENABLED !== 'true') {
    throw new Error('Live check requires explicit CASH_AI_ENABLED=true in .env or environment.')
}
const pdf = await readFile('test-fixtures/remittance-samples/multi-invoice-remittance.pdf')
try {
    const payment = await extractPayment(pdf, extractDocument)
    console.log(`Live extraction via ${providerName()} succeeded; confidence=${payment.extractionConfidence}.`)
} catch {
    console.error('Live extraction failed. Check provider credentials, model/PDF support and quota. Response omitted for privacy.')
    process.exitCode = 1
}
