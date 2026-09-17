// One-off live check: real OpenRouter extraction on a fixture PDF.
// Usage: node --import tsx scripts/live-ai-check.ts
process.env.CASH_AI_ENABLED = 'true';

const { extractDocument } = await import('../srv/genai/openai-compatible-client.js');
const { extractPayment } = await import('../srv/agents/extraction-agent.js');
const fs = await import('node:fs/promises');

const pdf = await fs.readFile('test-fixtures/remittance-samples/multi-invoice-remittance.pdf');
const payment = await extractPayment(pdf, extractDocument);
console.log('LIVE extraction result:');
console.log(JSON.stringify(payment, null, 2));
