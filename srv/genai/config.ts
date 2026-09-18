export class IntegrationUnavailableError extends Error {
    readonly statusCode = 503
}

export function requireAIEnabled(): void {
    if (process.env.CASH_AI_ENABLED !== 'true') {
        throw new IntegrationUnavailableError('AI is disabled. Configure credentials before setting CASH_AI_ENABLED=true.')
    }
}

export function openRouterKey(env: NodeJS.ProcessEnv = process.env): string {
    const direct = env.OPENROUTER_API_KEY?.trim()
    if (direct) return direct
    const name = env.CASH_AI_BINDING_NAME?.trim() || 'poc-cash-ai'
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
