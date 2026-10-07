// Remittance-advice PDFs for the local-only test open items
// (srv/fixtures/local-test-open-items.ts). Upload them via "Upload Payment".
// Each file exercises one matching case; 9900000103 deliberately has no PDF.
//
//   npm run pdf:test-cases   → test-fixtures/local-test-cases/*.pdf

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCAL_TEST_OPEN_ITEMS } from '../srv/fixtures/local-test-open-items.js';
import { createSimplePdf, pdfText } from './lib/simple-pdf.js';

interface InvoiceLine {
  /** Omitted when the advice states no invoice number. */
  invoice?: string;
  purchaseOrder?: string;
  invoiceDate?: string;
  gross: string;
  deduction?: string;
  paid: string;
}

interface AdviceCase {
  file: string;
  /** Expected result in the app; only documented in the README, never printed into the PDF. */
  expected: string;
  payer: string;
  address: string;
  date: string;
  paymentReference: string;
  payeeCompanyCode?: string;
  lines: InvoiceLine[];
  total: string;
  note: string;
}

const money = (amount: number, currency: string) =>
  `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function item(id: string) {
  const found = LOCAL_TEST_OPEN_ITEMS.find(entry => entry.OpenItemId === id);
  if (!found) throw new Error(`Unknown local test open item ${id}`);
  return found;
}

const northwind = item('9900000101');
const contoso = item('9900000102');
const tailspin = item('9900000104');
const litware = item('9900000105');
const adventure1 = item('9900000106');
const adventure2 = item('9900000107');
const proseware = item('9900000108');
const wideWorld = item('9900000109');
const coho = item('9900000110');

const CASES: AdviceCase[] = [
  {
    file: '01-full-payment-9900000101.pdf',
    expected: '9900000101 → 100 % (full, deterministic, no LLM call)',
    payer: northwind.CustomerName,
    address: '410 Market Street, Seattle, WA 98101, USA',
    date: '2026-09-28',
    paymentReference: 'WIRE-NW-260928-01',
    payeeCompanyCode: northwind.CompanyCode,
    lines: [{ invoice: northwind.OpenItemId, invoiceDate: northwind.DocumentDate, gross: money(northwind.InvoiceAmount, 'USD'), paid: money(northwind.InvoiceAmount, 'USD') }],
    total: money(northwind.InvoiceAmount, 'USD'),
    note: `Settlement of invoice ${northwind.OpenItemId} in full.`,
  },
  {
    file: '02a-partial-payment-1-of-2-9900000102.pdf',
    expected: '9900000102 → ~50 % (partial payment, to be checked)',
    payer: contoso.CustomerName,
    address: 'Friedrichstrasse 120, 10117 Berlin, Germany',
    date: '2026-09-25',
    paymentReference: 'SEPA-CONTOSO-0925',
    lines: [{ invoice: contoso.OpenItemId, invoiceDate: contoso.DocumentDate, gross: money(contoso.InvoiceAmount, 'EUR'), paid: money(20000, 'EUR') }],
    total: money(20000, 'EUR'),
    note: `First instalment (1 of 2) towards invoice ${contoso.OpenItemId}. The remaining 28,000.00 EUR follows.`,
  },
  {
    file: '02b-partial-payment-2-of-2-9900000102.pdf',
    expected: 'after 02a + 02b: 9900000102 → ~97 % (paid in 2 payments, probable)',
    payer: contoso.CustomerName,
    address: 'Friedrichstrasse 120, 10117 Berlin, Germany',
    date: '2026-10-02',
    paymentReference: 'SEPA-CONTOSO-1002',
    lines: [{ invoice: contoso.OpenItemId, invoiceDate: contoso.DocumentDate, gross: money(contoso.InvoiceAmount, 'EUR'), paid: money(28000, 'EUR') }],
    total: money(28000, 'EUR'),
    note: `Final instalment (2 of 2) towards invoice ${contoso.OpenItemId}; 20,000.00 EUR was paid on 2026-09-25.`,
  },
  {
    file: '04-typo-invoice-number-and-payer-name-9900000104.pdf',
    expected: '9900000104 → AI ~85–95 % (transposed invoice number 9900000140, payer "Tailspin Toys Incorporated"); rule fallback ~30 %',
    payer: 'Tailspin Toys Incorporated',
    address: '77 Harbor Road, Portland, OR 97209, USA',
    date: '2026-09-29',
    paymentReference: 'ACH-TT-0929',
    lines: [{ invoice: '9900000140', invoiceDate: tailspin.DocumentDate, gross: money(tailspin.InvoiceAmount, 'USD'), paid: money(tailspin.InvoiceAmount, 'USD') }],
    total: money(tailspin.InvoiceAmount, 'USD'),
    note: 'Payment of our open invoice from September 2026.',
  },
  {
    file: '05-short-payment-wrong-company-code-9900000105.pdf',
    expected: '9900000105 → ~50 % (14,700.00 of 15,000.00 USD after a 2 % discount, company code 1010 instead of 2060)',
    payer: litware.CustomerName,
    address: '2500 Innovation Drive, Austin, TX 78701, USA',
    date: '2026-09-30',
    paymentReference: 'WIRE-LIT-0930',
    payeeCompanyCode: '1010',
    lines: [{ invoice: litware.OpenItemId, invoiceDate: litware.DocumentDate, gross: money(litware.InvoiceAmount, 'USD'), deduction: money(300, 'USD') + ' (2% early payment discount)', paid: money(14700, 'USD') }],
    total: money(14700, 'USD'),
    note: 'Early payment discount of 2% deducted as agreed.',
  },
  {
    file: '06-one-payment-two-invoices-9900000106-9900000107.pdf',
    expected: '9900000106 + 9900000107 → 100 % each (one payment covers both invoices, deterministic)',
    payer: adventure1.CustomerName,
    address: '1 Adventure Way, Denver, CO 80202, USA',
    date: '2026-10-01',
    paymentReference: 'SEPA-AW-1001',
    lines: [
      { invoice: adventure1.OpenItemId, invoiceDate: adventure1.DocumentDate, gross: money(adventure1.InvoiceAmount, 'EUR'), paid: money(adventure1.InvoiceAmount, 'EUR') },
      { invoice: adventure2.OpenItemId, invoiceDate: adventure2.DocumentDate, gross: money(adventure2.InvoiceAmount, 'EUR'), paid: money(adventure2.InvoiceAmount, 'EUR') },
    ],
    total: money(adventure1.InvoiceAmount + adventure2.InvoiceAmount, 'EUR'),
    note: `Collective payment for invoices ${adventure1.OpenItemId} and ${adventure2.OpenItemId}.`,
  },
  {
    file: '07-wrong-currency-9900000108.pdf',
    expected: '9900000108 → ~40 % (paid 5,200.00 USD, invoice is 5,200.00 GBP)',
    payer: proseware.CustomerName,
    address: '18 King William Street, London EC4N 7BP, UK',
    date: '2026-10-03',
    paymentReference: 'SWIFT-PW-1003',
    lines: [{ invoice: proseware.OpenItemId, invoiceDate: proseware.DocumentDate, gross: money(proseware.InvoiceAmount, 'USD'), paid: money(proseware.InvoiceAmount, 'USD') }],
    total: money(proseware.InvoiceAmount, 'USD'),
    note: `Payment of invoice ${proseware.OpenItemId}.`,
  },
  {
    file: '08-overpayment-9900000109.pdf',
    expected: '9900000109 → ~30 % (overpayment: 2,150.00 USD for a 2,000.00 USD invoice)',
    payer: wideWorld.CustomerName,
    address: '900 Commerce Street, Dallas, TX 75202, USA',
    date: '2026-10-04',
    paymentReference: 'ACH-WWI-1004',
    lines: [{ invoice: wideWorld.OpenItemId, invoiceDate: wideWorld.DocumentDate, gross: money(wideWorld.InvoiceAmount, 'USD'), paid: money(2150, 'USD') }],
    total: money(2150, 'USD'),
    note: 'Includes 150.00 USD for freight charges not shown on the invoice.',
  },
  {
    file: '09-missing-invoice-number-9900000110.pdf',
    expected: '9900000110 → ~85 % (no invoice number, only a purchase order; customer, amount and currency agree)',
    payer: coho.CustomerName,
    address: 'Avenue Louise 54, 1050 Brussels, Belgium',
    date: '2026-10-05',
    paymentReference: 'SEPA-COHO-1005',
    lines: [{ purchaseOrder: 'PO-77812', gross: money(coho.InvoiceAmount, 'EUR'), paid: money(coho.InvoiceAmount, 'EUR') }],
    total: money(coho.InvoiceAmount, 'EUR'),
    note: 'Payment for purchase order PO-77812 (wine delivery, September 2026).',
  },
  {
    file: '10-unknown-payer-no-match.pdf',
    expected: 'no open item → 0 % (unknown payer and invoice 8800004711); payment stays in review',
    payer: 'Blue Yonder Airlines',
    address: '1 Airport Plaza, Miami, FL 33126, USA',
    date: '2026-10-06',
    paymentReference: 'WIRE-BYA-1006',
    lines: [{ invoice: '8800004711', invoiceDate: '2026-08-14', gross: money(1234.56, 'USD'), paid: money(1234.56, 'USD') }],
    total: money(1234.56, 'USD'),
    note: 'Payment for catering services, August 2026.',
  },
];

function renderAdvice(advice: AdviceCase): Buffer {
  const header = [
    `Payer: ${advice.payer}`,
    `Address: ${advice.address}`,
    `Payment date: ${advice.date}`,
    'Payment method: Bank transfer',
    `Payment reference: ${advice.paymentReference}`,
    ...(advice.payeeCompanyCode ? [`Payee company code: ${advice.payeeCompanyCode}`] : []),
  ];
  const invoiceBlocks = advice.lines.flatMap(line => [
    `Invoice number: ${line.invoice ?? 'not stated'}`,
    ...(line.purchaseOrder ? [`Purchase order: ${line.purchaseOrder}`] : []),
    ...(line.invoiceDate ? [`Invoice date: ${line.invoiceDate}`] : []),
    `Invoice amount: ${line.gross}`,
    ...(line.deduction ? [`Deduction: ${line.deduction}`] : []),
    `Paid amount: ${line.paid}`,
    '',
  ]);
  const text = (lines: string[]) => lines.map(line => `(${pdfText(line)}) Tj T*`).join('\n');
  const invoiceTop = 740 - header.length * 14 - 20;
  const totalTop = invoiceTop - invoiceBlocks.length * 13 - 10;
  return createSimplePdf(`
BT
/F2 16 Tf 20 TL
50 790 Td (REMITTANCE ADVICE) Tj T*
ET
BT
/F1 10 Tf 14 TL
50 750 Td
${text(header)}
ET
BT
/F2 10 Tf 13 TL
50 ${invoiceTop} Td
${text(invoiceBlocks)}
ET
BT
/F2 12 Tf 14 TL
50 ${totalTop} Td (${pdfText(`TOTAL PAID: ${advice.total}`)}) Tj T*
ET
BT
/F1 9 Tf 12 TL
50 ${totalTop - 30} Td (${pdfText(advice.note)}) Tj T*
ET
`);
}

function readme(): string {
  const rows = CASES.map(advice => `| \`${advice.file}\` | ${advice.payer} | ${advice.total} | ${advice.expected} |`);
  const items = LOCAL_TEST_OPEN_ITEMS.map(entry =>
    `| ${entry.OpenItemId} | ${entry.CustomerName} | ${money(entry.InvoiceAmount, entry.InvoiceAmountCurr)} | ${entry.CompanyCode} |`);
  return `# Local test cases — remittance advices

Generated by \`npm run pdf:test-cases\` (\`scripts/generate-test-case-pdfs.ts\`). Do not edit by hand.

The open items below exist **only locally** (\`source = LOCAL\`, defined in
\`srv/fixtures/local-test-open-items.ts\`). They are added at startup, are never
deleted by the S/4HANA sync and are cleared locally when posted — nothing is sent
to S/4HANA. Disable them with \`LOCAL_TEST_OPEN_ITEMS=false\`.

## Local open items

| Open item | Customer | Amount | Company code |
|-----------|----------|--------|--------------|
${items.join('\n')}

9900000103 (Fabrikam Industries Ltd.) has **no** advice on purpose: it must stay at 0 % ("not paid").

## Advices (upload via "Upload Payment")

| File | Payer | Total paid | Expected result |
|------|-------|-----------|-----------------|
${rows.join('\n')}

AI percentages are approximate (the LLM scores 0–99 %); 100 % is only given by the deterministic rule.
Upload 02a and 02b one after the other to see the partial payment become a full one.
`;
}

async function main() {
  const dir = join(process.cwd(), 'test-fixtures', 'local-test-cases');
  await mkdir(dir, { recursive: true });
  for (const advice of CASES) {
    const pdf = renderAdvice(advice);
    await writeFile(join(dir, advice.file), pdf);
    console.log(`Generated ${advice.file} (${pdf.length} bytes)`);
  }
  await writeFile(join(dir, 'README.md'), readme());
  console.log(`README.md written to ${dir}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
