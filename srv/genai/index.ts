import { IntegrationUnavailableError, requireAIEnabled } from './config.js'

export interface AIProvider {
    extractDocument(pdfBuffer: Buffer, prompt: string): Promise<string>
    generateText(prompt: string): Promise<string>
}

export function providerName(): 'openrouter' | 'aicore' {
    const name = process.env.CASH_AI_PROVIDER ?? 'aicore'
    if (name !== 'openrouter' && name !== 'aicore') {
        throw new IntegrationUnavailableError('CASH_AI_PROVIDER must be openrouter or aicore.')
    }
    return name
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
