import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { parseEnv } from 'node:util'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFile = promisify(execFileCallback)
export const SERVICE_NAME = 'poc-cash-ai'

type Operation = 'create' | 'update'
type Exec = (file: string, args: string[]) => Promise<{ stdout: string; stderr?: string }>

export interface ConfigureDependencies {
    exec?: Exec
    ask?: (question: string) => Promise<string>
    loadKey?: () => Promise<string>
}

async function keyFromEnvironment(): Promise<string> {
    let fileEnv: NodeJS.Dict<string> = {}
    try {
        fileEnv = parseEnv(await readFile(resolve('.env'), 'utf8'))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const key = process.env.OPENROUTER_API_KEY?.trim() || fileEnv.OPENROUTER_API_KEY?.trim()
    if (!key) throw new Error('OPENROUTER_API_KEY is missing in the environment or root .env.')
    return key
}

async function defaultAsk(question: string): Promise<string> {
    const input = createInterface({ input: stdin, output: stdout })
    try { return await input.question(question) } finally { input.close() }
}

async function serviceInstance(execute: Exec, target: string): Promise<{ exists: boolean; type?: string }> {
    const space = target.match(/^space:\s+(.+)$/im)?.[1]?.trim()
    if (!space) throw new Error('No Cloud Foundry space is targeted.')
    const { stdout: spaceGuid } = await execute('cf', ['space', space, '--guid'])
    const query = new URLSearchParams({ names: SERVICE_NAME, space_guids: spaceGuid.trim() })
    const { stdout: body } = await execute('cf', ['curl', `/v3/service_instances?${query}`])
    const result = JSON.parse(body) as { resources?: { type?: string }[] }
    const resources = result.resources ?? []
    if (resources.length > 1) throw new Error(`More than one CF service instance named ${SERVICE_NAME} exists in the target space.`)
    return { exists: resources.length === 1, type: resources[0]?.type }
}

export async function configureAIService(operation: Operation, dependencies: ConfigureDependencies = {}): Promise<void> {
    const execute = dependencies.exec ?? (async (file, args) => execFile(file, args, { encoding: 'utf8' }))
    const ask = dependencies.ask ?? defaultAsk
    const loadKey = dependencies.loadKey ?? keyFromEnvironment

    const { stdout: target } = await execute('cf', ['target'])
    console.log(target.trim())
    const instance = await serviceInstance(execute, target)
    if (operation === 'create' && instance.exists) {
        throw new Error(`${SERVICE_NAME} already exists; use the update operation explicitly.`)
    }
    if (operation === 'update' && (!instance.exists || instance.type !== 'user-provided')) {
        throw new Error(`${SERVICE_NAME} must already exist and be a user-provided service before update.`)
    }

    const expected = `${operation} ${SERVICE_NAME}`
    const answer = await ask(`Type "${expected}" to modify the service in the CF target above: `)
    if (answer.trim() !== expected) throw new Error('Cancelled; no Cloud Foundry changes were made.')

    const key = await loadKey()
    const directory = await mkdtemp(join(tmpdir(), 'poc-cash-ai-'))
    const credentialsPath = join(directory, 'credentials.json')
    try {
        await writeFile(credentialsPath, JSON.stringify({ OPENROUTER_API_KEY: key }), { mode: 0o600 })
        const command = operation === 'create' ? 'create-user-provided-service' : 'update-user-provided-service'
        await execute('cf', [command, SERVICE_NAME, '-p', credentialsPath])
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
    console.log(`${SERVICE_NAME} ${operation} completed. The credential value was not printed.`)
}

async function main(): Promise<void> {
    const operation = process.argv[2]
    if (operation !== 'create' && operation !== 'update') {
        throw new Error('Usage: node --import tsx scripts/configure-ai-cf.ts <create|update>')
    }
    await configureAIService(operation)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : 'AI service configuration failed.')
        process.exitCode = 1
    })
}
