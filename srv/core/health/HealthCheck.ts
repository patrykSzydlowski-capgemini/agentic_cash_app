import cds from '@sap/cds';

/**
 * Enterprise Health Probes for Cloud Foundry / Kubernetes
 * Inspired by the DHL template health checks
 */
export class HealthCheck {
    /**
     * Checks database connectivity
     */
    static async database(): Promise<boolean> {
        try {
            const db = await cds.connect.to('db');
            await db.run(cds.ql.SELECT.one.from('poc.cash.OpenItem'));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Checks AI configuration readiness
     */
    static async ai(): Promise<boolean> {
        try {
            // Check if AI Core destination or mock provider is declared
            const hasAiCore = Boolean(cds.env.requires?.aicore || process.env.AI_CORE_DESTINATION || process.env.VCAP_SERVICES);
            return hasAiCore || process.env.CASH_AI_PROVIDER !== 'aicore';
        } catch {
            return false;
        }
    }

    /**
     * Checks S/4HANA connectivity readiness
     */
    static async s4(): Promise<boolean> {
        try {
            const hasS4Config = Boolean(cds.env.requires?.s4 || process.env.S4_DESTINATION_NAME);
            return hasS4Config;
        } catch {
            return false;
        }
    }

    /**
     * Composite readiness probe
     */
    static async ready(): Promise<{ ready: boolean; details: Record<string, boolean> }> {
        const [database, ai, s4] = await Promise.all([
            this.database(),
            this.ai(),
            this.s4()
        ]);

        const details = { database, ai, s4 };
        const ready = database; // Database is mandatory for readiness; AI/S4 fall back gracefully
        return { ready, details };
    }
}

export default HealthCheck;
