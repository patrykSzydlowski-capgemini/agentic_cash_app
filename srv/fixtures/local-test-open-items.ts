// Local-only test open items (source = LOCAL). They never exist in S/4HANA:
// the startup sync keeps them, Agent 3 matches payments against them like ERP
// items, and posting clears them locally without calling S/4HANA.
// Remittance PDFs for these items: `npm run pdf:test-cases`
// (scripts/generate-test-case-pdfs.ts → test-fixtures/local-test-cases/).
// Disable with LOCAL_TEST_OPEN_ITEMS=false.

import { OPEN_ITEM_CLEARING_STATUS, OPEN_ITEM_SOURCE } from '../constants/index.js'

export interface LocalTestOpenItem {
    OpenItemId: string
    CompanyCode: string
    CustomerAccount: string
    CustomerName: string
    InvoiceAmount: number
    InvoiceAmountCurr: string
    PostingDate: string
    DocumentDate: string
}

export const LOCAL_TEST_OPEN_ITEMS: readonly LocalTestOpenItem[] = Object.freeze([
    { OpenItemId: '9900000101', CompanyCode: '2060', CustomerAccount: 'LTEST00101', CustomerName: 'Northwind Traders Inc.', InvoiceAmount: 12500.00, InvoiceAmountCurr: 'USD', PostingDate: '2026-09-01', DocumentDate: '2026-09-01' },
    { OpenItemId: '9900000102', CompanyCode: '2060', CustomerAccount: 'LTEST00102', CustomerName: 'Contoso Retail GmbH', InvoiceAmount: 48000.00, InvoiceAmountCurr: 'EUR', PostingDate: '2026-09-03', DocumentDate: '2026-09-02' },
    { OpenItemId: '9900000103', CompanyCode: '2060', CustomerAccount: 'LTEST00103', CustomerName: 'Fabrikam Industries Ltd.', InvoiceAmount: 7350.00, InvoiceAmountCurr: 'USD', PostingDate: '2026-09-05', DocumentDate: '2026-09-05' },
    { OpenItemId: '9900000104', CompanyCode: '2060', CustomerAccount: 'LTEST00104', CustomerName: 'Tailspin Toys Inc.', InvoiceAmount: 3980.00, InvoiceAmountCurr: 'USD', PostingDate: '2026-09-08', DocumentDate: '2026-09-08' },
    { OpenItemId: '9900000105', CompanyCode: '2060', CustomerAccount: 'LTEST00105', CustomerName: 'Litware Solutions LLC', InvoiceAmount: 15000.00, InvoiceAmountCurr: 'USD', PostingDate: '2026-09-10', DocumentDate: '2026-09-09' },
    { OpenItemId: '9900000106', CompanyCode: '2060', CustomerAccount: 'LTEST00106', CustomerName: 'Adventure Works Corp.', InvoiceAmount: 2400.00, InvoiceAmountCurr: 'EUR', PostingDate: '2026-09-12', DocumentDate: '2026-09-12' },
    { OpenItemId: '9900000107', CompanyCode: '2060', CustomerAccount: 'LTEST00106', CustomerName: 'Adventure Works Corp.', InvoiceAmount: 1600.00, InvoiceAmountCurr: 'EUR', PostingDate: '2026-09-12', DocumentDate: '2026-09-12' },
    { OpenItemId: '9900000108', CompanyCode: '2060', CustomerAccount: 'LTEST00108', CustomerName: 'Proseware Ltd.', InvoiceAmount: 5200.00, InvoiceAmountCurr: 'GBP', PostingDate: '2026-09-15', DocumentDate: '2026-09-14' },
    { OpenItemId: '9900000109', CompanyCode: '2060', CustomerAccount: 'LTEST00109', CustomerName: 'Wide World Importers Inc.', InvoiceAmount: 2000.00, InvoiceAmountCurr: 'USD', PostingDate: '2026-09-17', DocumentDate: '2026-09-17' },
    { OpenItemId: '9900000110', CompanyCode: '2060', CustomerAccount: 'LTEST00110', CustomerName: 'Coho Winery SA', InvoiceAmount: 6300.00, InvoiceAmountCurr: 'EUR', PostingDate: '2026-09-19', DocumentDate: '2026-09-18' },
])

export function localTestOpenItemsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return String(env.LOCAL_TEST_OPEN_ITEMS ?? 'true').trim().toLowerCase() !== 'false'
}

/** Rows for INSERT: new local items start OPEN and not dismissed. */
export function localTestOpenItemRows(): Array<Record<string, unknown>> {
    return LOCAL_TEST_OPEN_ITEMS.map(item => ({
        ...item,
        ClearingStatus: OPEN_ITEM_CLEARING_STATUS.OPEN,
        source: OPEN_ITEM_SOURCE.LOCAL,
        dismissed: false,
    }))
}
