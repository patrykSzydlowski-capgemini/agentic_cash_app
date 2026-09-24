import cds from '@sap/cds'

export class IntegrationUnavailableError extends Error {
    readonly statusCode = 503
}

export function requireAIEnabled(): void {
    // AI is always enabled by default
}

export function openRouterKey(env: NodeJS.ProcessEnv = process.env): string {
    const direct = env.OPENROUTER_API_KEY?.trim()
    if (direct) return direct

    const name = env.CASH_AI_BINDING_NAME?.trim() || 'poc-cash-ai'

    // 1. CAP-managed service binding (auto-injected from VCAP_SERVICES or cds bind)
    if (env === process.env) {
        const capBinding = (cds.env?.requires as Record<string, any> | undefined)?.[name]
        const capKey = capBinding?.credentials?.OPENROUTER_API_KEY
        if (typeof capKey === 'string' && capKey.trim()) {
            return capKey.trim()
        }
    }

    // 2. Direct VCAP_SERVICES parsing (supports isolated test environments and non-CAP executions)
    let services: unknown
    try {
        services = JSON.parse(env.VCAP_SERVICES || '{}')
    } catch {
        throw new IntegrationUnavailableError('Invalid VCAP_SERVICES JSON.')
    }
    if (!services || typeof services !== 'object' || Array.isArray(services)) {
        throw new IntegrationUnavailableError('Invalid VCAP_SERVICES structure.')
    }
    const entries = (services as Record<string, unknown>)['user-provided']
    if (entries !== undefined && !Array.isArray(entries)) {
        throw new IntegrationUnavailableError('Invalid user-provided bindings.')
    }
    const matches = (entries ?? []).filter((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return false
        const binding = entry as { name?: string; binding_name?: string }
        return binding.name === name || binding.binding_name === name
    })
    if (matches.length > 1) throw new IntegrationUnavailableError('Ambiguous AI credential binding.')
    const key = matches[0]?.credentials?.OPENROUTER_API_KEY
    if (typeof key === 'string' && key.trim()) return key.trim()
    throw new IntegrationUnavailableError('OPENROUTER_API_KEY is missing. Configure local .env or the named AI user-provided service.')
}
