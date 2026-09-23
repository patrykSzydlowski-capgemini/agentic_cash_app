import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function createSimplePdf(content: string): Buffer {
  const stream = Buffer.from(content, 'utf-8');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj',
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${content}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj'
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj + '\n';
  }
  const startXref = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'utf-8');
}

// 1. Exact match (100%) against S/4HANA invoice 0123456789 (Customer1, 1000 EUR)
const pdf100 = createSimplePdf(`
BT
/F2 16 Tf 20 TL
50 780 Td (REMITTANCE ADVICE / AWIZO PLATNICZE - EXACT MATCH 100%) Tj T*
ET
BT
/F1 10 Tf 14 TL
50 740 Td (Payer / Platnik: Customer1 Manufacturing Ltd.) Tj T*
(Address: Industrial Park 12, 60-001 Poznan, Poland) Tj T*
(Date: 2026-02-15) Tj T*
(Payment Method: Electronic Wire Transfer) Tj T*
(Payment Reference: WIRE-2026-0123456789) Tj T*
ET

BT
/F2 10 Tf 12 TL
50 660 Td (Invoice Number: 0123456789) Tj T*
(Invoice Date: 2026-01-01) Tj T*
(Gross Amount: 1,000.00 EUR) Tj T*
(Paid Amount: 1,000.00 EUR) Tj T*
ET

BT
/F2 12 Tf 14 TL
50 580 Td (TOTAL PAID: EUR 1,000.00) Tj T*
ET
BT
/F1 9 Tf 12 TL
50 540 Td (Settlement of invoice 0123456789 in full.) Tj T*
ET
`);

// 2. Partial / Ambiguous match (~55-60%) against S/4HANA invoice 0123456791 (Customer3, 3000 EUR, paid 1800 EUR)
const pdf50 = createSimplePdf(`
BT
/F2 16 Tf 20 TL
50 780 Td (REMITTANCE ADVICE / AWIZO PLATNICZE - PARTIAL MATCH ~60%) Tj T*
ET
BT
/F1 10 Tf 14 TL
50 740 Td (Payer / Platnik: Customer3 Logistics Sp. z o.o.) Tj T*
(Address: Logistics Hub 5, 00-950 Warsaw, Poland) Tj T*
(Date: 2026-02-15) Tj T*
(Payment Method: SEPA Credit Transfer) Tj T*
(Payment Reference: PARTIAL-PAY-0123456791) Tj T*
ET

BT
/F2 10 Tf 12 TL
50 660 Td (Invoice Number: 0123456791) Tj T*
(Total Invoice Amount: 3,000.00 EUR) Tj T*
(Payment Stage: Instalment 1 of 2 - 60 percent) Tj T*
(Paid Amount: 1,800.00 EUR) Tj T*
ET

BT
/F2 12 Tf 14 TL
50 580 Td (TOTAL PAID: EUR 1,800.00) Tj T*
ET
BT
/F1 9 Tf 12 TL
50 540 Td (Partial payment of 1,800.00 EUR towards invoice 0123456791 (3,000.00 EUR total).) Tj T*
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
50 740 Td (Payer / Platnik: Global Unknown Supplies Ltd.) Tj T*
(Address: 99 Baker Street, London, UK) Tj T*
(Date: 2026-02-15) Tj T*
(Payment Method: International Wire Transfer) Tj T*
(Payment Reference: WIRE-GLOBAL-999) Tj T*
ET

BT
/F2 10 Tf 12 TL
50 660 Td (Invoice Number: INV-999-NOTFOUND) Tj T*
(Invoice Date: 2026-02-10) Tj T*
(Paid Amount: 450.00 EUR) Tj T*
ET

BT
/F2 12 Tf 14 TL
50 580 Td (TOTAL PAID: EUR 450.00) Tj T*
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
