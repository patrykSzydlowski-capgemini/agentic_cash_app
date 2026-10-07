// Adapted from AlexanderX/ts-agentic-poc (Apache-2.0).
// Optional SAP AI Core adapter. Importing this module never makes a request.
import { requireAIEnabled } from './config.js'
import type { AIExecutionResult, TokenUsage } from './types.js'
export { IntegrationUnavailableError } from './config.js'

type Message = {
    role: 'user'
    content: string | ({ type: 'text'; text: string } | {
        type: 'file'; file: { file_data: string; filename: string }
    })[]
}
export type ClientFactory = () => Promise<{
    chatCompletion(input: { messages: Message[] }): Promise<any>
}>

export function orchestrationConfig() {
    const destinationName = process.env.AICORE_DESTINATION?.trim()
    const deploymentId = process.env.AICORE_DEPLOYMENT_ID?.trim()
    return {
        model: process.env.AICORE_MODEL ?? 'anthropic--claude-4.5-sonnet',
        resourceGroup: process.env.AICORE_RESOURCE_GROUP ?? 'default',
        ...(deploymentId ? { deploymentId } : {}),
        ...(destinationName ? { destinationName } : {}),
    }
}

const createClient: ClientFactory = async () => {
    const { OrchestrationClient } = await import('@sap-ai-sdk/orchestration')
    const config = orchestrationConfig()
    const destination = config.destinationName
        ? { destinationName: config.destinationName }
        : undefined
    const deploymentId = config.deploymentId || (process.env.CASH_AI_PROVIDER === 'aicore' || !process.env.CASH_AI_PROVIDER ? 'd0fb4c15c05a7ab0' : undefined)
    const deploymentConfig: { resourceGroup: string; deploymentId?: string } = {
        resourceGroup: config.resourceGroup,
        ...(deploymentId ? { deploymentId } : {}),
    }
    return new OrchestrationClient(
        { promptTemplating: { model: { name: config.model } } },
        deploymentConfig,
        destination,
    )
}

async function completeWithUsage(messages: Message[], factory: ClientFactory): Promise<AIExecutionResult> {
    requireAIEnabled()
    let response: any
    try {
        const client = await factory()
        response = await client.chatCompletion({ messages })
    } catch (err) {
        // If destination failed (e.g. RBAC error) and direct binding is available, fall back to direct binding
        if (process.env.AICORE_DESTINATION) {
            try {
                const { OrchestrationClient } = await import('@sap-ai-sdk/orchestration')
                const config = orchestrationConfig()
                const deploymentId = config.deploymentId || (process.env.CASH_AI_PROVIDER === 'aicore' || !process.env.CASH_AI_PROVIDER ? 'd0fb4c15c05a7ab0' : undefined)
                const deploymentConfig: { resourceGroup: string; deploymentId?: string } = {
                    resourceGroup: config.resourceGroup,
                    ...(deploymentId ? { deploymentId } : {}),
                }
                const directClient = new OrchestrationClient(
                    { promptTemplating: { model: { name: config.model } } },
                    deploymentConfig,
                )
                response = await directClient.chatCompletion({ messages })
            } catch {
                const dest = ` (destination: "${process.env.AICORE_DESTINATION}")`
                throw new Error(`SAP orchestration request failed${dest}. Check destination, binding, model, resource group and quota.`)
            }
        } else {
            throw new Error('SAP orchestration request failed. Check destination, binding, model, resource group and quota.')
        }
    }
    const content = typeof response.getContent === 'function' ? response.getContent() : response?.content
    if (!content?.trim()) throw new Error('Orchestration service returned no content.')

    let usage: TokenUsage | undefined
    try {
        const rawUsage = typeof response.getTokenUsage === 'function' ? response.getTokenUsage() : response.usage
        if (rawUsage) {
            usage = {
                promptTokens: rawUsage.prompt_tokens ?? rawUsage.promptTokens ?? 0,
                completionTokens: rawUsage.completion_tokens ?? rawUsage.completionTokens ?? 0,
                totalTokens: rawUsage.total_tokens ?? rawUsage.totalTokens ?? 0,
            }
        }
    } catch {
        // Non-critical if token usage extraction fails
    }

    const model = orchestrationConfig().model
    return { content, usage, model }
}

export async function extractDocument(pdfBuffer: Buffer, prompt: string, factory: ClientFactory = createClient): Promise<string> {
    return (await extractDocumentWithUsage(pdfBuffer, prompt, factory)).content
}

export async function extractDocumentWithUsage(pdfBuffer: Buffer, prompt: string, factory: ClientFactory = createClient): Promise<AIExecutionResult> {
    return completeWithUsage([{
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
    return (await generateTextWithUsage(prompt, factory)).content
}

export async function generateTextWithUsage(prompt: string, factory: ClientFactory = createClient): Promise<AIExecutionResult> {
    return completeWithUsage([{ role: 'user', content: prompt }], factory)
}
