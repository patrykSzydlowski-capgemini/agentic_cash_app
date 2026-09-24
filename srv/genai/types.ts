export interface TokenUsage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}

export interface AIExecutionResult {
    content: string
    usage?: TokenUsage
    model?: string
}

export interface AIProvider {
    extractDocument(pdfBuffer: Buffer, prompt: string): Promise<string>
    generateText(prompt: string): Promise<string>
    extractDocumentWithUsage?(pdfBuffer: Buffer, prompt: string): Promise<AIExecutionResult>
    generateTextWithUsage?(prompt: string): Promise<AIExecutionResult>
}
