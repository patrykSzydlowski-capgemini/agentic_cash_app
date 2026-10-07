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
      id: '<remittance-inv-9123456799@friends-foes.com>',
      from: 'Accounting <billing@friends-foes.com>',
      subject: 'Payment Remittance Advice - Invoice 9123456799',
      body: 'Dear Accounts Receivable Team,\n\nPlease find attached the remittance advice for invoice 9123456799 in the amount of 7,659.00 USD.\nPayment was initiated via wire transfer.\n\nBest regards,\nFriends and Foes US Finance Team',
    },
    {
      file: 'sample-awizo-50pct.pdf',
      id: '<partial-remittance-9123456999@garfild.com>',
      from: 'Payment Processing <ap@garfild.com>',
      subject: 'Partial Payment Advice note Ref 9123456999',
      body: 'Hello,\n\nWe have executed partial settlement (instalment 1 of 2 - 50%) for invoice 9123456999 in amount of 45,600.00 USD. Attached is the payment specification.\n\nRegards,\nGarfild Inc.',
    },
    {
      file: 'sample-awizo-0pct.pdf',
      id: '<marketing-advice-999@apex-consulting.org>',
      from: 'Apex Consulting Partners <ap@apex-consulting.org>',
      subject: 'Remittance advice for freelance marketing invoice INV-999-NOTFOUND',
      body: 'Dear Partner,\n\nPlease find attached payment details for freelance marketing consultation in amount of 500.00 USD.\n\nBest regards,\nApex Consulting Partners Ltd.',
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
  const destinationName = process.env.MAIL_DESTINATION_NAME
    ?? (cds.env?.requires as any)?.mail?.credentials?.destination
    ?? 'mail-read';
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

function isPdfAttachment(att: { filename?: string; contentType?: string }): boolean {
  const type = (att.contentType || '').toLowerCase();
  const name = (att.filename || '').toLowerCase();
  return type === 'application/pdf' || name.endsWith('.pdf');
}

interface BodyStructureNode {
  type?: string;
  parameters?: Record<string, string>;
  dispositionParameters?: Record<string, string>;
  childNodes?: BodyStructureNode[];
}

/** Walks an IMAP BODYSTRUCTURE tree and reports whether any part is a PDF. */
export function bodyStructureHasPdf(node: BodyStructureNode | undefined): boolean {
  if (!node) return false;
  const filename = node.dispositionParameters?.filename || node.parameters?.name || '';
  if (isPdfAttachment({ filename, contentType: node.type })) return true;
  return (node.childNodes || []).some((child) => bodyStructureHasPdf(child));
}

/** Keeps only PDF attachments; returns null when the message carries none. */
function withPdfAttachmentsOnly(message: MailboxMessage): MailboxMessage | null {
  const pdfs = message.attachments.filter((att) => isPdfAttachment(att) && att.content.length > 0);
  return pdfs.length > 0 ? { ...message, attachments: pdfs } : null;
}

/**
 * Agent 1 (mail intake): returns only messages that carry at least one PDF and
 * are not yet known locally (`isKnown(messageId)` → true skips the message).
 *
 * IMAP: envelope + BODYSTRUCTURE are fetched first (cheap), the full source is
 * downloaded only for new PDF messages. Messages are never marked as seen, so the
 * dedup key is the RFC 822 Message-ID, not the IMAP \Seen flag.
 */
export async function fetchNewPdfMailboxMessages(
  isKnown: (messageId: string) => Promise<boolean>,
): Promise<MailboxMessage[]> {
  const destinationName = process.env.MAIL_DESTINATION_NAME
    ?? (cds.env?.requires as any)?.mail?.credentials?.destination
    ?? 'mail-read';
  const forceMock = process.env.MAILBOX_USE_MOCK === 'true';
  const config = forceMock ? null : await loadMailDestination(destinationName);

  if (!config) {
    const result: MailboxMessage[] = [];
    for (const message of await loadMockMessages()) {
      const pdfMessage = withPdfAttachmentsOnly(message);
      if (pdfMessage && !(await isKnown(pdfMessage.messageId))) result.push(pdfMessage);
    }
    return result;
  }

  const allowInsecureTls = process.env.IMAP_ALLOW_INSECURE_TLS === 'true';
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.useSsl,
    auth: { user: config.user, pass: config.password },
    tls: allowInsecureTls ? { rejectUnauthorized: false } : undefined,
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    // Pass 1: headers only. No IMAP commands may run inside the fetch iterator.
    const headers: Array<{ uid: number; messageId: string; hasPdf: boolean }> = [];
    const mailbox = client.mailbox;
    if (mailbox && mailbox.exists > 0) {
      for await (const msg of client.fetch('1:*', { uid: true, envelope: true, bodyStructure: true })) {
        headers.push({
          uid: msg.uid,
          messageId: msg.envelope?.messageId || `<uid-${msg.uid}@imap-mailbox>`,
          hasPdf: bodyStructureHasPdf(msg.bodyStructure as BodyStructureNode | undefined),
        });
      }
    }

    const candidates: typeof headers = [];
    let skippedNoPdf = 0;
    let skippedKnown = 0;
    for (const header of headers) {
      if (!header.hasPdf) { skippedNoPdf++; continue; }
      if (await isKnown(header.messageId)) { skippedKnown++; continue; }
      candidates.push(header);
    }

    // Pass 2: download full source only for new PDF messages.
    const messages: MailboxMessage[] = [];
    for (const candidate of candidates) {
      try {
        const full = await client.fetchOne(String(candidate.uid), { source: true }, { uid: true });
        if (!full || !full.source) continue;
        const parsed = await simpleParser(full.source);
        const pdfMessage = withPdfAttachmentsOnly({
          messageId: parsed.messageId || candidate.messageId,
          subject: parsed.subject || '',
          from: parsed.from?.text || '',
          bodyText: parsed.text || '',
          attachments: (parsed.attachments || []).map((att) => ({
            filename: att.filename || 'attachment.pdf',
            contentType: att.contentType || 'application/octet-stream',
            content: att.content,
          })),
        });
        if (pdfMessage) messages.push(pdfMessage);
      } catch (err) {
        LOG.warn('[Mailbox] Failed to download message', { uid: candidate.uid, error: (err as Error).message });
      }
    }

    LOG.info('[Mailbox] Intake finished', {
      scanned: headers.length,
      skippedNoPdf,
      skippedKnown,
      downloaded: messages.length,
    });
    return messages;
  } finally {
    lock.release();
    await client.logout();
  }
}

export interface MailboxContextResult {
  hasMatches: boolean;
  summary: string;
  matchedMessages: Array<{
    subject: string;
    from: string;
    snippet: string;
    messageId: string;
  }>;
}

/**
 * Searches mailbox messages (unread or recent messages from IMAP, or local fixtures)
 * for context matching an exception in payment (references, payer name, or amount).
 */
export async function searchMailboxContext(
  params: {
    payer?: string;
    references?: string[];
    amount?: number;
  },
  cachedMessages?: MailboxMessage[]
): Promise<MailboxContextResult> {
  try {
    const messages = cachedMessages && cachedMessages.length > 0 ? cachedMessages : await listUnreadMailboxMessages();
    const refs = (params.references || []).map((r) => r.trim().toLowerCase()).filter(Boolean);
    const payerClean = (params.payer || '').trim().toLowerCase();
    const amountStr = params.amount && params.amount > 0 ? String(params.amount) : null;

    const matched: MailboxContextResult['matchedMessages'] = [];

    for (const msg of messages) {
      const subjectLower = msg.subject.toLowerCase();
      const bodyLower = msg.bodyText.toLowerCase();
      const fromLower = msg.from.toLowerCase();
      const attNamesLower = msg.attachments.map((a) => a.filename.toLowerCase()).join(' ');

      const refMatch = refs.some(
        (ref) => subjectLower.includes(ref) || bodyLower.includes(ref) || attNamesLower.includes(ref)
      );

      const payerTokens = payerClean
        .replace(/[^a-z0-9]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 4);
      const payerMatch = payerTokens.some(
        (token) => fromLower.includes(token) || subjectLower.includes(token) || bodyLower.includes(token)
      );

      const amountMatch = amountStr ? (bodyLower.includes(amountStr) || subjectLower.includes(amountStr)) : false;

      if (refMatch || payerMatch || (refs.length === 0 && amountMatch)) {
        const cleanSnippet = msg.bodyText
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200);

        matched.push({
          subject: msg.subject,
          from: msg.from,
          snippet: cleanSnippet || '(brak treści)',
          messageId: msg.messageId,
        });
      }
    }

    if (matched.length > 0) {
      const summaryLines = matched.map(
        (m, i) => `[Email #${i + 1}] Od: ${m.from} | Temat: "${m.subject}" | Treść: "${m.snippet}"`
      );
      return {
        hasMatches: true,
        summary: `Znaleziono powiązane wiadomości e-mail w skrzynce (${matched.length}):\n${summaryLines.join('\n')}`,
        matchedMessages: matched,
      };
    }

    return {
      hasMatches: false,
      summary: 'Brak powiązanych wiadomości e-mail w skrzynce pocztowej dla danego płatnika/faktury.',
      matchedMessages: [],
    };
  } catch (err) {
    LOG.warn(`[Mailbox Search] Could not search mailbox: ${(err as Error).message}`);
    return {
      hasMatches: false,
      summary: 'Weryfikacja skrzynki pocztowej pominięta (serwer pocztowy niedostępny).',
      matchedMessages: [],
    };
  }
}
