// One-off manual sanity-check runner for Agent 3 (matching-agent.ts) — same
// pattern as run-extraction-fixtures.ts. Not a formal test. Re-extracts the
// 4 fixtures that succeeded in the extraction sample-run (the 5th,
// ambiguous-free-text-memo.pdf, fails extraction by design), fetches open
// items broadly (Task 2's customerAccount-less getOpenItems), and prints
// proposeMatches' output for each payment side by side.
//
// Needs the HD0_BAS destination bound, same as any other S/4 call:
//   cds bind --exec -- npm run matching:sample-run

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractPayment, type ExtractedPayment } from '../srv/agents/extraction-agent.js';
import { proposeMatches } from '../srv/agents/matching-agent.js';
import { getOpenItems } from '../srv/s4/open-items-client.js';

const FIXTURES_DIR = path.join(__dirname, '..', 'test-fixtures', 'remittance-samples');
const FIXTURE_FILES = [
  'multi-invoice-remittance.pdf',
  'partial-payment-note.pdf',
  'scanned-check-stub.pdf',
  'wire-transfer-advice.pdf',
];

async function main(): Promise<void> {
  console.log('Fetching open items (broad, no customerAccount filter)...');
  const openItems = await getOpenItems();
  console.log(`Fetched ${openItems.length} open item(s).\n`);

  for (const file of FIXTURE_FILES) {
    console.log(`=== ${file} ===`);
    try {
      const pdfBuffer = await readFile(path.join(FIXTURES_DIR, file));
      const payment: ExtractedPayment = await extractPayment(pdfBuffer);
      console.log('Extracted payment:', JSON.stringify(payment, null, 2));

      const candidates = await proposeMatches(payment, openItems);
      console.log('Proposed matches:', JSON.stringify(candidates, null, 2));
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
