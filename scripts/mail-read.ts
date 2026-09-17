import { getDestination } from '@sap-cloud-sdk/connectivity';
import Imap from 'imap';
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
  const envFile = path.join(__dirname, 'default-env.json');
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
 * of unread messages in INBOX. Adjust the search criteria and
 * box name for your real remittance-advice mailbox/folder.
 */
function fetchUnreadMessages(config: MailDestinationProps): Promise<void> {
  return new Promise((resolve, reject) => {
    // WARNING: setting IMAP_ALLOW_INSECURE_TLS=true disables certificate
    // verification. Only use this temporarily behind a trusted corporate
    // proxy for local debugging - never in production. Prefer setting
    // NODE_EXTRA_CA_CERTS to the corporate root CA instead.
    const allowInsecureTls = process.env.IMAP_ALLOW_INSECURE_TLS === 'true';
    if (allowInsecureTls) {
      console.warn('WARNING: TLS certificate verification is disabled (IMAP_ALLOW_INSECURE_TLS=true).');
    }

    const imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.useSsl,
      tlsOptions: allowInsecureTls ? { rejectUnauthorized: false } : undefined
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) return reject(err);

        imap.search(['UNSEEN'], (searchErr, results) => {
          if (searchErr) return reject(searchErr);

          if (!results || results.length === 0) {
            console.log('No unread messages found.');
            imap.end();
            return resolve();
          }

          const fetcher = imap.fetch(results, { bodies: '', markSeen: false });

          fetcher.on('message', (msg, seqno) => {
            msg.on('body', (stream) => {
              simpleParser(stream as any, (parseErr, parsed) => {
                if (parseErr) {
                  console.error(`Failed to parse message #${seqno}:`, parseErr);
                  return;
                }
                console.log(`--- Message #${seqno} ---`);
                console.log('From:', parsed.from?.text);
                console.log('Subject:', parsed.subject);
                console.log('Attachments:', parsed.attachments.map(a => a.filename));
              });
            });
          });

          fetcher.once('error', (fetchErr) => reject(fetchErr));
          fetcher.once('end', () => {
            imap.end();
            resolve();
          });
        });
      });
    });

    imap.once('error', (err: Error) => reject(err));
    imap.connect();
  });
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
