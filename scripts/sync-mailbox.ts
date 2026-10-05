// End-to-end AR Mailbox Synchronization check against a running server (npm run dev / npm run watch):
//   node --import tsx scripts/sync-mailbox.ts
import { loadEnvFile } from 'node:process';

const BASE_URL = process.env.CASH_DEV_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:4004';

try {
  loadEnvFile('.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

interface ODataError {
  error?: { message?: string };
}

interface IngestionLogEntry {
  ID: string;
  timestamp: string;
  source: string;
  messageId: string;
  subject: string;
  filename: string | null;
  classificationDecision: string;
  classificationReason: string;
  payment_ID: string | null;
}

async function odata<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/odata/v4/cash-sync${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error(`Cannot reach ${BASE_URL}. Start the server first (npm run dev).`);
  }
  const body = (await response.json()) as T & ODataError;
  if (!response.ok) {
    throw new Error(`OData request failed (${response.status}): ${body.error?.message ?? 'unknown error'}`);
  }
  return body;
}

async function main() {
  console.log(`Connecting to ${BASE_URL}/odata/v4/cash-sync ...`);
  console.log('Triggering CashSyncService.syncMailbox() ...\n');

  const { value } = await odata<{ value: IngestionLogEntry[] }>('/syncMailbox', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  console.log(`Sync completed! Processed ${value?.length ?? 0} item(s):\n`);

  if (!value || value.length === 0) {
    console.log('No new mailbox items processed (or all items were already logged duplicates).');
  } else {
    for (const log of value) {
      console.log(`- [${log.classificationDecision.toUpperCase()}] ${log.subject}`);
      console.log(`    Message-ID: ${log.messageId}`);
      console.log(`    File:       ${log.filename ?? '(none)'}`);
      console.log(`    Reason:     ${log.classificationReason}`);
      console.log(`    Payment ID: ${log.payment_ID ?? '(none)'}`);
      console.log('');
    }
  }

  // Fetch recent IngestionLog entries from the audit trail
  const logs = await odata<{ value: IngestionLogEntry[] }>('/IngestionLog?$top=5&$orderby=timestamp desc');
  console.log(`\nAudit Trail (Top 5 recent records in IngestionLog):`);
  for (const l of logs.value) {
    console.log(`- ${l.timestamp} [${l.source}] ${l.subject} -> ${l.classificationDecision} (Payment: ${l.payment_ID ?? 'N/A'})`);
  }
}

main().catch((err) => {
  console.error('Mailbox sync script failed:', err.message);
  process.exit(1);
});
