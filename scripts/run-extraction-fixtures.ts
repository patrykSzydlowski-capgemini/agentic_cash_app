// One-off manual sanity-check runner for Agent 2 (extraction-agent.ts) — see
// CLAUDE.md's task backlog. Not a formal test; prints extractPayment's output
// for every PDF in test-fixtures/remittance-samples/ side by side so results
// can be eyeballed across layouts before fixture-based tests are written.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractPayment } from '../srv/agents/extraction-agent.js';

const FIXTURES_DIR = path.join(__dirname, '..', 'test-fixtures', 'remittance-samples');

async function main(): Promise<void> {
  const entries = await readdir(FIXTURES_DIR);
  const pdfFiles = entries.filter((name) => name.toLowerCase().endsWith('.pdf')).sort();

  if (pdfFiles.length === 0) {
    console.log(`No PDFs found in ${FIXTURES_DIR}`);
    return;
  }

  for (const file of pdfFiles) {
    const filePath = path.join(FIXTURES_DIR, file);
    console.log(`\n=== ${file} ===`);
    try {
      const pdfBuffer = await readFile(filePath);
      const result = await extractPayment(pdfBuffer);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
