import type { AIProvider } from './types.js'
import { IntegrationUnavailableError, requireAIEnabled } from './config.js'

export function providerName(): 'openrouter' | 'aicore' {
    const name = process.env.CASH_AI_PROVIDER ?? 'aicore'
    if (name !== 'openrouter' && name !== 'aicore') {
        throw new IntegrationUnavailableError('CASH_AI_PROVIDER must be openrouter or aicore.')
    }
    return name
}

export function activeModelName(): string {
    const provider = process.env.CASH_AI_PROVIDER ?? 'aicore'
    if (provider === 'aicore') {
        const cdsAi = (global as any).cds?.env?.requires?.aicore
        return process.env.AICORE_MODEL ?? cdsAi?.model ?? 'gemini-2.5-flash'
    }
    return process.env.OPENROUTER_MODEL ?? 'inclusionai/ling-3.0-flash-fin:free'
}

export async function getProvider(): Promise<AIProvider> {
    requireAIEnabled()
    return providerName() === 'aicore'
        ? import('./orchestration-client.js')
        : import('./openai-compatible-client.js')
}

export async function extractDocument(pdfBuffer: Buffer, prompt: string): Promise<string> {
    return (await getProvider()).extractDocument(pdfBuffer, prompt)
}

export async function generateText(prompt: string): Promise<string> {
    return (await getProvider()).generateText(prompt)
}
