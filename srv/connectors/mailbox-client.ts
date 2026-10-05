import cds from '@sap/cds';
import { getDestination } from '@sap-cloud-sdk/connectivity';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';

const LOG = cds.log('mailbox-client');

export interface MailboxAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailboxMessage {
  messageId: string;
  subject: string;
  from: string;
  bodyText: string;
  attachments: MailboxAttachment[];
}

interface MailDestinationProps {
  host: string;
  port: number;
  useSsl: boolean;
  user: string;
  password: string;
}

function loadLocalVcapServices(): void {
  if (process.env.VCAP_SERVICES) return;
  const envFile = path.join(process.cwd(), 'default-env.json');
  if (!fs.existsSync(envFile)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(envFile, 'utf-8'));
    if (raw.VCAP_SERVICES) {
      process.env.VCAP_SERVICES = JSON.stringify(raw.VCAP_SERVICES);
    }
  } catch (err) {
    LOG.warn(`Could not parse default-env.json: ${(err as Error).message}`);
  }
}

loadLocalVcapServices();

/**
 * Loads IMAP connection properties from SAP BTP Destination service.
 */
async function loadMailDestination(destinationName: string): Promise<MailDestinationProps | null> {
  try {
    const destination = await getDestination({ destinationName });
    if (!destination) return null;

    const props = destination.originalProperties ?? {};
    const host = props['mail.imap.host'] as string | undefined;
    const port = props['mail.imap.port'] as string | number | undefined;
    const ssl = props['mail.imap.ssl.enable'] as string | boolean | undefined;

    if (!host || !port) {
      LOG.warn(`Destination "${destinationName}" is missing mail.imap.host or mail.imap.port.`);
      return null;
    }

    const user = destination.username || (props['mail.user'] as string) || '';
    const password = destination.password || (props['mail.password'] as string) || '';

    if (!user || !password) {
      LOG.warn(`Destination "${destinationName}" has no credentials (user/password).`);
      return null;
    }

    return {
      host,
      port: Number(port),
      useSsl: ssl === true || ssl === 'true',
      user,
      password,
    };
  } catch (err) {
    LOG.warn(`Failed to resolve destination "${destinationName}": ${(err as Error).message}`);
    return null;
  }
}

/**
 * Loads mock fixture emails for local testing when no BTP IMAP destination is available.
 */
async function loadMockMessages(): Promise<MailboxMessage[]> {
  LOG.info('[Mailbox] Using local fixture mock mailbox for testing/development.');
  const fixtures: MailboxMessage[] = [];

  const sampleFiles = [
    {
      file: 'sample-awizo-100pct.pdf',
      id: '<remittance-inv-1001@acme-corp.com>',
      from: 'Accounting <billing@acme-corp.com>',
      subject: 'Payment Remittance Advice - Invoice OP-1001',
      body: 'Dear Accounts Receivable Team,\n\nPlease find attached the remittance advice for invoice OP-1001 in the amount of 12,500.00 EUR.\nPayment was initiated via SEPA transfer.\n\nBest regards,\nACME Corp Finance Team',
    },
    {
      file: 'sample-awizo-50pct.pdf',
      id: '<partial-remittance-772@logistics-plus.com>',
      from: 'Payment Processing <ap@logistics-plus.com>',
      subject: 'Partial Payment Advice note Ref LP-7720',
      body: 'Hello,\n\nWe have executed partial settlement for recent shipments. Attached is the payment specification.\n\nRegards,\nLogistics Plus AG',
    },
    {
      file: 'sample-awizo-0pct.pdf',
      id: '<event-invitation-2026@logistics-summit.org>',
      from: 'Logistics Summit 2026 <newsletter@logistics-summit.org>',
      subject: 'Invitation: European Logistics & Supply Chain Summit 2026',
      body: 'Dear Partner,\n\nWe are pleased to invite your finance and operations teams to the annual Summit.\nPlease find the agenda PDF attached.\n\nSee you there!',
    },
  ];

  for (const sample of sampleFiles) {
    let pdfPath = path.resolve(process.cwd(), sample.file);
    if (!fs.existsSync(pdfPath)) {
      pdfPath = path.resolve(process.cwd(), 'test-fixtures', sample.file);
    }

    let buffer = Buffer.alloc(0);
    if (fs.existsSync(pdfPath)) {
      buffer = await fs.promises.readFile(pdfPath);
    }

    fixtures.push({
      messageId: sample.id,
      subject: sample.subject,
      from: sample.from,
      bodyText: sample.body,
      attachments: [
        {
          filename: sample.file,
          contentType: 'application/pdf',
          content: buffer,
        },
      ],
    });
  }

  return fixtures;
}

/**
 * Connects to IMAP mailbox and fetches unread messages in a single session.
 * Read-only: leaves messages as unseen (`seen: false`).
 */
export async function listUnreadMailboxMessages(): Promise<MailboxMessage[]> {
  const destinationName = process.env.MAIL_DESTINATION_NAME ?? 'mail-read';
  const forceMock = process.env.MAILBOX_USE_MOCK === 'true';

  if (!forceMock) {
    const config = await loadMailDestination(destinationName);
    if (config) {
      LOG.info(`[Mailbox] Connecting to IMAP server ${config.host}:${config.port} (${config.user})...`);
      const allowInsecureTls = process.env.IMAP_ALLOW_INSECURE_TLS === 'true';

      const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.useSsl,
        auth: {
          user: config.user,
          pass: config.password,
        },
        tls: allowInsecureTls ? { rejectUnauthorized: false } : undefined,
        logger: false,
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      const messages: MailboxMessage[] = [];

      try {
        for await (const message of client.fetch({ seen: false }, { source: true, envelope: true })) {
          if (!message.source) continue;
          try {
            const parsed = await simpleParser(message.source);
            const attachments: MailboxAttachment[] = (parsed.attachments || []).map((att) => ({
              filename: att.filename || 'unknown.pdf',
              contentType: att.contentType || 'application/octet-stream',
              content: att.content,
            }));

            messages.push({
              messageId: parsed.messageId || `<uid-${message.uid}@imap-mailbox>`,
              subject: parsed.subject || '',
              from: parsed.from?.text || '',
              bodyText: parsed.text || '',
              attachments,
            });
          } catch (parseErr) {
            LOG.warn(`[Mailbox] Failed to parse message UID ${message.uid}: ${(parseErr as Error).message}`);
          }
        }
        LOG.info(`[Mailbox] Fetched ${messages.length} unread message(s) from IMAP server.`);
        return messages;
      } finally {
        lock.release();
        await client.logout();
      }
    }
  }

  return loadMockMessages();
}
