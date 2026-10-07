import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSimplePdf } from './lib/simple-pdf.js';

// 1. Exact match (100%) against live S/4HANA invoice 9123456799 (Friends and Foes US, 7,659.00 USD)
const pdf100 = createSimplePdf(`
BT
/F2 16 Tf 20 TL
50 780 Td (REMITTANCE ADVICE / AWIZO PLATNICZE - EXACT MATCH 100%) Tj T*
ET
BT
/F1 10 Tf 14 TL
50 740 Td (Payer / Platnik: Friends and Foes US) Tj T*
(Address: 1200 Broadway, New York, NY 10001, USA) Tj T*
(Date: 2026-04-04) Tj T*
(Payment Method: Electronic Wire Transfer) Tj T*
(Payment Reference: WIRE-2026-9123456799) Tj T*
ET

BT
/F2 10 Tf 12 TL
50 660 Td (Invoice Number: 9123456799) Tj T*
(Invoice Date: 2026-04-04) Tj T*
(Gross Amount: 7,659.00 USD) Tj T*
(Paid Amount: 7,659.00 USD) Tj T*
ET

BT
/F2 12 Tf 14 TL
50 580 Td (TOTAL PAID: USD 7,659.00) Tj T*
ET
BT
/F1 9 Tf 12 TL
50 540 Td (Settlement of invoice 9123456799 in full.) Tj T*
ET
`);

// 2. Partial / Ambiguous match (~50%) against live S/4HANA invoice 9123456999 (Garfild Inc., 91,200.00 USD, paid 45,600.00 USD)
const pdf50 = createSimplePdf(`
BT
/F2 16 Tf 20 TL
50 780 Td (REMITTANCE ADVICE / AWIZO PLATNICZE - PARTIAL MATCH ~50%) Tj T*
ET
BT
/F1 10 Tf 14 TL
50 740 Td (Payer / Platnik: Garfild Inc.) Tj T*
(Address: 500 Tech Blvd, Silicon Valley, CA 94025, USA) Tj T*
(Date: 2026-06-06) Tj T*
(Payment Method: Electronic Wire Transfer) Tj T*
(Payment Reference: PARTIAL-PAY-9123456999) Tj T*
ET

BT
/F2 10 Tf 12 TL
50 660 Td (Invoice Number: 9123456999) Tj T*
(Total Invoice Amount: 91,200.00 USD) Tj T*
(Payment Stage: Instalment 1 of 2 - 50 percent) Tj T*
(Paid Amount: 45,600.00 USD) Tj T*
ET

BT
/F2 12 Tf 14 TL
50 580 Td (TOTAL PAID: USD 45,600.00) Tj T*
ET
BT
/F1 9 Tf 12 TL
50 540 Td (Partial payment of 45,600.00 USD towards invoice 9123456999 (91,200.00 USD total).) Tj T*
ET
`);

// 3. No match (0%) - Unknown payer and non-existent invoice in S/4HANA
const pdf0 = createSimplePdf(`
BT
/F2 16 Tf 20 TL
50 780 Td (REMITTANCE ADVICE / AWIZO PLATNICZE - NO MATCH 0%) Tj T*
ET
BT
/F1 10 Tf 14 TL
50 740 Td (Payer / Platnik: Apex Consulting Partners Ltd.) Tj T*
(Address: 99 Baker Street, London, UK) Tj T*
(Date: 2026-02-15) Tj T*
(Payment Method: International Wire Transfer) Tj T*
(Payment Reference: WIRE-APEX-999) Tj T*
ET

BT
/F2 10 Tf 12 TL
50 660 Td (Invoice Number: INV-999-NOTFOUND) Tj T*
(Invoice Date: 2026-02-10) Tj T*
(Paid Amount: 500.00 USD) Tj T*
ET

BT
/F2 12 Tf 14 TL
50 580 Td (TOTAL PAID: USD 500.00) Tj T*
ET
BT
/F1 9 Tf 12 TL
50 540 Td (Payment for freelance marketing consultation.) Tj T*
ET
`);

async function main() {
  const root = process.cwd();
  const pairs = [
    { name: 'sample-awizo-100pct.pdf', buf: pdf100 },
    { name: 'sample-awizo-50pct.pdf', buf: pdf50 },
    { name: 'sample-awizo-0pct.pdf', buf: pdf0 },
  ];

  for (const { name, buf } of pairs) {
    await writeFile(join(root, name), buf);
    await writeFile(join(root, 'test-fixtures', name), buf);
    console.log(`Generated ${name} (${buf.length} bytes) in root and test-fixtures/`);
  }
}

main().catch(console.error);
