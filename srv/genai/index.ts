// Barrel export for the genai subsystem
export type { AIProvider, TokenUsage, AIExecutionResult } from './types.js'
export { calculateTokenCost, calculateCapacityUnits } from './cost-calculator.js'

export {
    providerName,
    activeModelName,
    getProvider,
    extractDocument,
    extractDocumentWithUsage,
    generateText,
    generateTextWithUsage,
} from './provider-factory.js'

export {
    IntegrationUnavailableError,
    requireAIEnabled,
    openRouterKey,
} from './config.js'
