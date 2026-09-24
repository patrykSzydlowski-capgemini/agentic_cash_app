// Token cost calculation for various LLM models supported in SAP AI Core & GenAI Hub.

export interface ModelPricing {
    promptPerMillion: number
    completionPerMillion: number
}

const PRICING_TABLE: Record<string, ModelPricing> = {
    'gemini-2.5-flash': { promptPerMillion: 0.075, completionPerMillion: 0.30 },
    'gemini-1.5-flash': { promptPerMillion: 0.075, completionPerMillion: 0.30 },
    'gemini-2.5-pro': { promptPerMillion: 1.25, completionPerMillion: 5.00 },
    'gemini-1.5-pro': { promptPerMillion: 1.25, completionPerMillion: 5.00 },
    'anthropic--claude-4.5-sonnet': { promptPerMillion: 3.00, completionPerMillion: 15.00 },
    'anthropic--claude-4-sonnet': { promptPerMillion: 3.00, completionPerMillion: 15.00 },
    'claude-3-5-sonnet': { promptPerMillion: 3.00, completionPerMillion: 15.00 },
    'claude-3-5-haiku': { promptPerMillion: 0.80, completionPerMillion: 4.00 },
    'gpt-4o': { promptPerMillion: 2.50, completionPerMillion: 10.00 },
    'gpt-4o-mini': { promptPerMillion: 0.15, completionPerMillion: 0.60 },
}

const DEFAULT_PRICING: ModelPricing = { promptPerMillion: 0.10, completionPerMillion: 0.40 }

function normalizeKey(str: string): string {
    return str.toLowerCase().replace(/[-_.]/g, '')
}

/**
 * Returns the estimated cost in USD for a given model and token usage.
 */
export function calculateTokenCost(model: string, promptTokens: number, completionTokens: number): number {
    const norm = normalizeKey(model || '')
    const key = Object.keys(PRICING_TABLE).find(k => {
        const normK = normalizeKey(k)
        return norm.includes(normK) || normK.includes(norm)
    })
    const pricing = key ? PRICING_TABLE[key] : DEFAULT_PRICING

    const promptCost = ((promptTokens || 0) / 1_000_000) * pricing.promptPerMillion
    const completionCost = ((completionTokens || 0) / 1_000_000) * pricing.completionPerMillion
    const totalCost = promptCost + completionCost

    // Round to 4 decimal places (e.g. 0.0002)
    return Math.round(totalCost * 10000) / 10000
}

/**
 * SAP BTP Generative AI Capacity Units (CU) schedule per 1M tokens.
 * Based on SAP Service Description Guide (SDG) & SAP Discovery Center AI Core Calculator:
 * - Standard/Lightweight models: 0.10 CU prompt / 0.40 CU completion per 1M tokens.
 * - Medium models (Pro / Haiku): 1.25 CU prompt / 5.00 CU completion per 1M tokens.
 * - Advanced/Heavy reasoning models (Sonnet / GPT-4o): 3.00 CU prompt / 15.00 CU completion per 1M tokens.
 */
export interface ModelCapacityUnits {
    promptPerMillionCU: number
    completionPerMillionCU: number
}

const CAPACITY_UNITS_TABLE: Record<string, ModelCapacityUnits> = {
    'gemini-2.5-flash': { promptPerMillionCU: 0.10, completionPerMillionCU: 0.40 },
    'gemini-1.5-flash': { promptPerMillionCU: 0.10, completionPerMillionCU: 0.40 },
    'gemini-2.5-pro': { promptPerMillionCU: 1.25, completionPerMillionCU: 5.00 },
    'gemini-1.5-pro': { promptPerMillionCU: 1.25, completionPerMillionCU: 5.00 },
    'anthropic--claude-4.5-sonnet': { promptPerMillionCU: 3.00, completionPerMillionCU: 15.00 },
    'anthropic--claude-4-sonnet': { promptPerMillionCU: 3.00, completionPerMillionCU: 15.00 },
    'claude-3-5-sonnet': { promptPerMillionCU: 3.00, completionPerMillionCU: 15.00 },
    'claude-3-5-haiku': { promptPerMillionCU: 0.80, completionPerMillionCU: 4.00 },
    'gpt-4o': { promptPerMillionCU: 3.00, completionPerMillionCU: 15.00 },
    'gpt-4o-mini': { promptPerMillionCU: 0.15, completionPerMillionCU: 0.60 },
}

const DEFAULT_CU: ModelCapacityUnits = { promptPerMillionCU: 0.15, completionPerMillionCU: 0.60 }

/**
 * Returns estimated SAP BTP Capacity Units (CU) for a given model and token usage.
 */
export function calculateCapacityUnits(model: string, promptTokens: number, completionTokens: number): number {
    const norm = normalizeKey(model || '')
    const key = Object.keys(CAPACITY_UNITS_TABLE).find(k => {
        const normK = normalizeKey(k)
        return norm.includes(normK) || normK.includes(norm)
    })
    const cuPricing = key ? CAPACITY_UNITS_TABLE[key] : DEFAULT_CU

    const promptCU = ((promptTokens || 0) / 1_000_000) * cuPricing.promptPerMillionCU
    const completionCU = ((completionTokens || 0) / 1_000_000) * cuPricing.completionPerMillionCU
    const totalCU = promptCU + completionCU

    // Round to 4 decimal places
    return Math.round(totalCU * 10000) / 10000
}

