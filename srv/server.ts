import cds from '@sap/cds';
import { HealthCheck } from './core/health/HealthCheck.js';

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

const logger = cds.log('server');

cds.on('bootstrap', (app: any) => {
    // Liveness probe (Kubernetes / Cloud Foundry)
    app.get('/health/live', (_req: any, res: any) => {
        res.status(HTTP_OK).json({ status: 'UP', timestamp: new Date().toISOString() });
    });

    // Readiness probe (Database & service dependencies)
    app.get('/health/ready', async (_req: any, res: any) => {
        try {
            const { ready, details } = await HealthCheck.ready();
            res.status(ready ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE).json({
                status: ready ? 'UP' : 'DOWN',
                timestamp: new Date().toISOString(),
                checks: details
            });
        } catch (error) {
            logger.error('Health check ready probe failed:', error);
            res.status(HTTP_SERVICE_UNAVAILABLE).json({ status: 'DOWN', error: String(error) });
        }
    });
});

export default cds.server;
