import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { configureAIService, SERVICE_NAME } from '../scripts/configure-ai-cf.js'

const target = 'api endpoint: https://example.invalid\norg: test\nspace: test'

function executor(options: { exists?: boolean; type?: string } = {}) {
    const calls: { file: string; args: string[]; credentials?: string }[] = []
    return {
        calls,
        exec: async (file: string, args: string[]) => {
            const call = { file, args: [...args] } as (typeof calls)[number]
            calls.push(call)
            if (args[0] === 'target') return { stdout: target }
            if (args[0] === 'space') return { stdout: 'space-guid\n' }
            if (args[0] === 'curl') {
                assert.match(args[1], /space_guids=space-guid/)
                return { stdout: JSON.stringify({ resources: options.exists ? [{ type: options.type }] : [] }) }
            }
            const path = args.at(-1)!
            call.credentials = await readFile(path, 'utf8')
            return { stdout: '' }
        },
    }
}

test('create transfers only the key via a temporary credentials file and cleans it', async () => {
    const fake = executor()
    await configureAIService('create', {
        exec: fake.exec,
        ask: async () => `create ${SERVICE_NAME}`,
        loadKey: async () => 'super-secret',
    })
    const mutation = fake.calls.find(call => call.args[0] === 'create-user-provided-service')!
    assert.deepEqual(JSON.parse(mutation.credentials!), { OPENROUTER_API_KEY: 'super-secret' })
    assert.ok(!mutation.args.join(' ').includes('super-secret'))
    await assert.rejects(access(mutation.args.at(-1)!))
})

test('cancel performs no credential read and no CF mutation', async () => {
    const fake = executor()
    let read = false
    await assert.rejects(() => configureAIService('create', {
        exec: fake.exec,
        ask: async () => 'no',
        loadKey: async () => { read = true; return 'secret' },
    }), /Cancelled/)
    assert.equal(read, false)
    assert.equal(fake.calls.some(call => call.args[0]?.includes('user-provided-service')), false)
})

test('update refuses a non-user-provided service', async () => {
    const fake = executor({ exists: true, type: 'managed' })
    await assert.rejects(() => configureAIService('update', {
        exec: fake.exec,
        ask: async () => `update ${SERVICE_NAME}`,
        loadKey: async () => 'secret',
    }), /must already exist and be a user-provided service/)
    assert.equal(fake.calls.some(call => call.args[0] === 'update-user-provided-service'), false)
})
