// Unit tests for the OpenAI-compatible (OpenRouter) client with an injected
// HTTP layer — no network access in tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    extractDocument,
    generateText,
    IntegrationUnavailableError,
    type HttpPostJson,
} from '../srv/genai/openai-compatible-client.js';

function okResponse(content: string | { text?: string }[]) {
    return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
        text: async () => '',
    };
}

function stubHttpPost(capture: { url?: string; body?: unknown }, respond: () => unknown): HttpPostJson {
    return async (url, init) => {
        capture.url = url;
        capture.body = JSON.parse(init.body);
        return respond() as Awaited<ReturnType<HttpPostJson>>;
    };
}

test('generateText posts to OpenRouter chat completions with model and key', async () => {
    process.env.CASH_AI_ENABLED = 'true';
    process.env.OPENROUTER_API_KEY = 'test-key';
    const capture: { url?: string; body?: unknown } = {};
    const httpPost = stubHttpPost(capture, () => okResponse('hello'));

    const result = await generateText('ping', httpPost);

    assert.equal(result, 'hello');
    assert.equal(capture.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.match((capture.body as { model: string }).model, /:free|^[a-z]/);
    assert.equal((capture.body as { model: string }).model, 'thinkingmachines/inkling-small:free');
    assert.equal((capture.body as { messages: unknown[] }).messages.length, 1);
    delete process.env.OPENROUTER_MODEL;
});

test('extractDocument sends the PDF as base64 data URL', async () => {
    process.env.CASH_AI_ENABLED = 'true';
    process.env.OPENROUTER_API_KEY = 'test-key';
    const capture: { url?: string; body?: unknown } = {};
    const httpPost = stubHttpPost(capture, () => okResponse('{"payer":"x"}'));
    const pdfBytes = Buffer.from('%PDF-fake');

    const result = await extractDocument(pdfBytes, 'extract it', httpPost);

    assert.equal(result, '{"payer":"x"}');
    const parts = (capture.body as { messages: { content: unknown[] }[] }).messages[0].content as {
        type: string; file?: { file_data: string };
    }[];
    const filePart = parts.find(p => p.type === 'file') as { file: { file_data: string } };
    assert.match(filePart.file.file_data, /^data:application\/pdf;base64,/);
    assert.ok(filePart.file.file_data.includes(Buffer.from('%PDF-fake').toString('base64')));
});

test('client throws when disabled or key missing, never silently mocks', async () => {
    delete process.env.CASH_AI_ENABLED;
    await assert.rejects(
        () => extractDocument(Buffer.from('x'), 'p', stubHttpPost({}, () => okResponse('x'))),
        IntegrationUnavailableError,
    );

    process.env.CASH_AI_ENABLED = 'true';
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(
        () => generateText('p', stubHttpPost({}, () => okResponse('x'))),
        IntegrationUnavailableError,
    );
    delete process.env.OPENROUTER_API_KEY;
});

test('provider error surfaces with status and body', async () => {
    process.env.CASH_AI_ENABLED = 'true';
    process.env.OPENROUTER_API_KEY = 'test-key';
    const failing: HttpPostJson = async () => ({
        ok: false,
        status: 402,
        json: async () => ({}),
        text: async () => '{"error":"insufficient credits"}',
    });
    await assert.rejects(
        () => generateText('p', failing),
        /AI provider request failed \(402\)/,
    );
    delete process.env.OPENROUTER_API_KEY;
});

test('network failure propagates instead of falling back to mocks', async () => {
    process.env.CASH_AI_ENABLED = 'true';
    process.env.OPENROUTER_API_KEY = 'test-key';
    const networkError: HttpPostJson = async () => {
        throw new Error('getaddrinfo ENOTFOUND openrouter.ai');
    };
    await assert.rejects(
        () => extractDocument(Buffer.from('%PDF'), 'p', networkError),
        /ENOTFOUND/,
    );
    delete process.env.OPENROUTER_API_KEY;
});
