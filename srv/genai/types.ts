export interface AIProvider {
    extractDocument(pdfBuffer: Buffer, prompt: string): Promise<string>
    generateText(prompt: string): Promise<string>
}
