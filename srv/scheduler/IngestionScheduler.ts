import cds from '@sap/cds';

const LOG = cds.log('ingestion-scheduler');

let pollerHandle: NodeJS.Timeout | null = null;
let isPollingActive = false;

export function startMailPoller(intervalMs = 300000) {
  if (pollerHandle) {
    LOG.warn('[Scheduler] Mail poller is already running.');
    return;
  }

  LOG.info(`[Scheduler] Starting background mail poller (interval: ${intervalMs / 1000}s)`);

  const tick = async () => {
    if (isPollingActive) {
      LOG.info('[Scheduler] Previous poller tick still in progress — skipping this interval.');
      return;
    }
    isPollingActive = true;
    try {
      const service = await cds.connect.to('CashSyncService');
      LOG.info('[Scheduler] Triggering syncMailbox action from scheduler tick...');
      await service.send('syncMailbox', {});
    } catch (err) {
      LOG.error(`[Scheduler] Error in mail poller tick: ${(err as Error).message}`);
    } finally {
      isPollingActive = false;
    }
  };

  pollerHandle = setInterval(tick, intervalMs);
}

export function stopMailPoller() {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
    LOG.info('[Scheduler] Mail poller stopped.');
  }
}
