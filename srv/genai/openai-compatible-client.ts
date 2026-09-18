// OpenAI-compatible chat-completions client, aimed at OpenRouter but usable
// with any compatible endpoint (OPENROUTER_BASE_URL override: OpenAI, Groq,
// local gateways, ...). Disabled by design unless CASH_AI_ENABLED=true;
// throws instead of silently falling back to mocks.
// The HTTP layer is injectable so tests never hit the network.

import { openRouterKey, requireAIEnabled } from './config.js'
export { IntegrationUnavailableError } from './config.js'

export type HttpPostJson = (url: string, init: {
    headers: Record<string, string>
    body: string
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

async function defaultHttpPost(url: string, init: { headers: Record<string, string>; body: string }) {
    return fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(120_000) })
}

export function baseUrl(): string {
    return process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'
}

export function model(): string {
    return process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free'
}

function apiKey(): string {
    requireAIEnabled()
    return openRouterKey()
}

async function chat(messages: unknown, httpPost: HttpPostJson = defaultHttpPost): Promise<string> {
    const response = await httpPost(`${baseUrl()}/chat/completions`, {
        headers: {
            Authorization: `Bearer ${apiKey()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: model(), messages }),
    })

    if (!response.ok) {
        throw new Error(`AI provider request failed (${response.status}). Check provider configuration and quota.`)
    }

    const data = await response.json() as {
        choices?: { message?: { content?: string | { text?: string }[] } }[]
    }
    const raw = data.choices?.[0]?.message?.content
    const content = typeof raw === 'string'
        ? raw
        : Array.isArray(raw) ? raw.map(part => part?.text ?? '').join('') : undefined
    if (!content?.trim()) throw new Error('AI provider returned no content.')
    return content
}

export async function extractDocument(pdfBuffer: Buffer, prompt: string, httpPost: HttpPostJson = defaultHttpPost): Promise<string> {
    return chat([{
        role: 'user',
        content: [
            { type: 'text', text: prompt },
            { type: 'file', file: {
                file_data: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
                filename: 'document.pdf',
            } },
        ],
    }], httpPost)
}

export async function generateText(prompt: string, httpPost: HttpPostJson = defaultHttpPost): Promise<string> {
    return chat([{ role: 'user', content: prompt }], httpPost)
}
