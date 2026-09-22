import { getDestination } from '@sap-cloud-sdk/connectivity';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * @sap-cloud-sdk/connectivity only reads process.env.VCAP_SERVICES —
 * it does NOT auto-load default-env.json (that's a CAP/cds convention).
 * This loads it manually when running locally/in BAS, outside Cloud Foundry.
 */
function loadLocalVcapServices(): void {
  if (process.env.VCAP_SERVICES) {
    return; // already set (e.g. real Cloud Foundry runtime)
  }
  const envFile = path.resolve('default-env.json');
  if (!fs.existsSync(envFile)) {
    return;
  }
  const raw = JSON.parse(fs.readFileSync(envFile, 'utf-8'));
  if (raw.VCAP_SERVICES) {
    process.env.VCAP_SERVICES = JSON.stringify(raw.VCAP_SERVICES);
    console.log('Loaded VCAP_SERVICES from default-env.json');
  }
}

loadLocalVcapServices();

interface MailDestinationProps {
  host: string;
  port: number;
  useSsl: boolean;
  user: string;
  password: string;
}

/**
 * Reads a BTP "MAIL" type destination and extracts the IMAP
 * connection properties from its additional properties.
 */
async function loadMailDestination(destinationName: string): Promise<MailDestinationProps> {
  const destination = await getDestination({ destinationName });

  if (!destination) {
    throw new Error(`Destination "${destinationName}" not found. Check the name and that it is deployed to this subaccount.`);
  }

  const debugCopy: Record<string, unknown> = { ...destination };
  if (debugCopy.password) debugCopy.password = '***MASKED***';
  if (debugCopy.originalProperties) {
    const propsCopy = { ...(debugCopy.originalProperties as Record<string, unknown>) };
    for (const key of Object.keys(propsCopy)) {
      if (/pass/i.test(key)) propsCopy[key] = '***MASKED***';
    }
    debugCopy.originalProperties = propsCopy;
  }
  console.log('Raw destination object:', JSON.stringify(debugCopy, null, 2));

  const props = destination.originalProperties ?? {};
  const host = props['mail.imap.host'];
  const port = props['mail.imap.port'];
  const ssl = props['mail.imap.ssl.enable'];

  if (!host || !port) {
    throw new Error('Destination is missing mail.imap.host / mail.imap.port additional properties.');
  }

  const user = destination.username || props['mail.user'] || '';
  const password = destination.password || props['mail.password'] || '';

  console.log(`Resolved destination auth -> user: "${user}" (${user ? 'present' : 'EMPTY'}), password: ${password ? 'present, length ' + password.length : 'EMPTY'}`);

  if (!user || !password) {
    throw new Error(
      'Destination did not return a username/password. Check the "User" and "Password" ' +
      'fields under Authentication in the BTP destination editor - if they are set there ' +
      'but still come back empty, the Authentication type may not be BasicAuthentication, ' +
      'or the destination needs to be re-saved.'
    );
  }

  return {
    host,
    port: Number(port),
    useSsl: ssl === 'true',
    user,
    password
  };
}

/**
 * Connects via IMAP and prints the subject/sender/attachments
 * of unread messages in INBOX using modern ImapFlow client.
 */
async function fetchUnreadMessages(config: MailDestinationProps): Promise<void> {
  const allowInsecureTls = process.env.IMAP_ALLOW_INSECURE_TLS === 'true';
  if (allowInsecureTls) {
    console.warn('WARNING: TLS certificate verification is disabled (IMAP_ALLOW_INSECURE_TLS=true).');
  }

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
  try {
    let count = 0;
    for await (const message of client.fetch({ seen: false }, { source: true })) {
      count++;
      if (message.source) {
        const parsed = await simpleParser(message.source);
        console.log(`--- Message #${count} ---`);
        console.log('From:', parsed.from?.text);
        console.log('Subject:', parsed.subject);
        console.log('Attachments:', parsed.attachments.map((a) => a.filename));
      }
    }
    if (count === 0) {
      console.log('No unread messages found.');
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

async function main() {
  const destinationName = process.env.MAIL_DESTINATION_NAME ?? 'mail-read';
  console.log(`Loading destination "${destinationName}"...`);
  const config = await loadMailDestination(destinationName);
  console.log(`Connecting to ${config.host}:${config.port} as ${config.user}`);
  await fetchUnreadMessages(config);
}

main().catch((err) => {
  console.error('Mail read test failed:', err);
  process.exit(1);
});
