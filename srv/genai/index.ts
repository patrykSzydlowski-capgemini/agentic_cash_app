// Barrel export for the genai subsystem
export type { AIProvider } from './types.js'

export {
    providerName,
    activeModelName,
    getProvider,
    extractDocument,
    generateText,
} from './provider-factory.js'

export {
    IntegrationUnavailableError,
    requireAIEnabled,
    openRouterKey,
} from './config.js'
