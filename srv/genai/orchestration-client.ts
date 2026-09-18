// Adapted from AlexanderX/ts-agentic-poc (Apache-2.0).
// Optional SAP AI Core adapter. Importing this module never makes a request.
import { requireAIEnabled } from './config.js'
export { IntegrationUnavailableError } from './config.js'

type Message = {
    role: 'user'
    content: string | ({ type: 'text'; text: string } | {
        type: 'file'; file: { file_data: string; filename: string }
    })[]
}
export type ClientFactory = () => Promise<{
    chatCompletion(input: { messages: Message[] }): Promise<{ getContent(): string | undefined }>
}>

export function orchestrationConfig() {
    return {
        model: process.env.AICORE_MODEL ?? 'anthropic--claude-4.5-sonnet',
        resourceGroup: process.env.AICORE_RESOURCE_GROUP ?? 'default',
    }
}

const createClient: ClientFactory = async () => {
    const { OrchestrationClient } = await import('@sap-ai-sdk/orchestration')
    const config = orchestrationConfig()
    return new OrchestrationClient(
        { promptTemplating: { model: { name: config.model } } },
        { resourceGroup: config.resourceGroup },
    )
}

async function complete(messages: Message[], factory: ClientFactory): Promise<string> {
    requireAIEnabled()
    let content: string | undefined
    try {
        const client = await factory()
        content = (await client.chatCompletion({ messages })).getContent()
    } catch {
        // SDK errors may contain service credentials or document text.
        throw new Error('SAP orchestration request failed. Check binding, model, resource group and quota.')
    }
    if (!content?.trim()) throw new Error('Orchestration service returned no content.')
    return content
}

export async function extractDocument(pdfBuffer: Buffer, prompt: string, factory: ClientFactory = createClient): Promise<string> {
    return complete([{
        role: 'user',
        content: [
            { type: 'text', text: prompt },
            { type: 'file', file: {
                file_data: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
                filename: 'document.pdf',
            } },
        ],
    }], factory)
}

export async function generateText(prompt: string, factory: ClientFactory = createClient): Promise<string> {
    return complete([{ role: 'user', content: prompt }], factory)
}
