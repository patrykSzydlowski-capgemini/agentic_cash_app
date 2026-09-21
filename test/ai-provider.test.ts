import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { openRouterKey } from '../srv/genai/config.js'
import { providerName } from '../srv/genai/index.js'
import { extractDocument, generateText, orchestrationConfig, type ClientFactory } from '../srv/genai/orchestration-client.js'

const originalEnv = { ...process.env }
afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
    Object.assign(process.env, originalEnv)
})

test('OpenRouter credential prefers environment over named CF binding', () => {
    const env = {
        OPENROUTER_API_KEY: ' direct-key ',
        VCAP_SERVICES: JSON.stringify({ 'user-provided': [{
            name: 'poc-cash-ai', credentials: { OPENROUTER_API_KEY: 'binding-key' },
        }] }),
    }
    assert.equal(openRouterKey(env), 'direct-key')
})

test('OpenRouter credential is read only from the explicitly named CF binding', () => {
    const env = {
        CASH_AI_BINDING_NAME: 'selected-ai',
        VCAP_SERVICES: JSON.stringify({ 'user-provided': [
            { name: 'other-ai', credentials: { OPENROUTER_API_KEY: 'wrong' } },
            { name: 'selected-ai', credentials: { OPENROUTER_API_KEY: 'right' } },
        ] }),
    }
    assert.equal(openRouterKey(env), 'right')
})

test('provider defaults to SAP AI Core and rejects unknown values', () => {
    delete process.env.CASH_AI_PROVIDER
    assert.equal(providerName(), 'aicore')
    process.env.CASH_AI_PROVIDER = 'unknown'
    assert.throws(() => providerName(), /openrouter or aicore/)
})

test('SAP orchestration adapter passes text and PDF messages through injected client', async () => {
    process.env.CASH_AI_ENABLED = 'true'
    const inputs: unknown[] = []
    const factory: ClientFactory = async () => ({
        chatCompletion: async input => {
            inputs.push(input)
            return { getContent: () => 'ok' }
        },
    })
    assert.equal(await generateText('hello', factory), 'ok')
    assert.equal(await extractDocument(Buffer.from('%PDF'), 'extract', factory), 'ok')
    assert.match(JSON.stringify(inputs[1]), /data:application\/pdf;base64/)
})

test('SAP orchestration adapter sanitizes SDK errors and supports config overrides', async () => {
    process.env.CASH_AI_ENABLED = 'true'
    process.env.AICORE_MODEL = 'custom-model'
    process.env.AICORE_RESOURCE_GROUP = 'custom-group'
    assert.deepEqual(orchestrationConfig(), { model: 'custom-model', resourceGroup: 'custom-group' })
    const factory: ClientFactory = async () => ({
        chatCompletion: async () => { throw new Error('secret service response') },
    })
    await assert.rejects(() => generateText('hello', factory), error => {
        assert.doesNotMatch(String(error), /secret service response/)
        return true
    })
})
