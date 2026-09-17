// Adapted from AlexanderX/ts-agentic-poc (Apache-2.0).
// All live completions go through SAP AI Core / Generative AI Hub.
// Disabled by default: importing the module never contacts a remote service.

export class IntegrationUnavailableError extends Error {
  readonly statusCode = 503;
}

async function createClient() {
  if (process.env.CASH_AI_ENABLED !== 'true') {
    throw new IntegrationUnavailableError('AI extraction/resolution is disabled. Configure SAP AI Core and explicitly set CASH_AI_ENABLED=true.');
  }
  const { OrchestrationClient } = await import('@sap-ai-sdk/orchestration');
  return new OrchestrationClient(
    { promptTemplating: { model: { name: process.env.AICORE_MODEL ?? 'anthropic--claude-4.5-sonnet' } } },
    { resourceGroup: process.env.AICORE_RESOURCE_GROUP ?? 'default' },
  );
}

function getContentOrThrow(response: { getContent(): string | undefined }): string {
  const content = response.getContent();
  if (!content?.trim()) throw new Error('Orchestration service returned no content.');
  return content;
}

export async function extractDocument(pdfBuffer: Buffer, prompt: string): Promise<string> {
  const client = await createClient();
  const response = await client.chatCompletion({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'file', file: {
          file_data: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
          filename: 'document.pdf',
        } },
      ],
    }],
  });
  return getContentOrThrow(response);
}

export async function generateText(prompt: string): Promise<string> {
  const client = await createClient();
  return getContentOrThrow(await client.chatCompletion({
    messages: [{ role: 'user', content: prompt }],
  }));
}
