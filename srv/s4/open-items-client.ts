// Adapted from AlexanderX/ts-agentic-poc (Apache-2.0).
// Destination-backed S/4 read adapter via CAP remote service (ZAC_OPENITEMS_MOC_O4).

import cds from '@sap/cds';

export interface OpenItem {
  openItemId: string;
  postingDate?: string | null;
  documentDate?: string | null;
  companyCode: string;
  customerAccount: string;
  customerName: string;
  invoiceAmountCurrency: string;
  invoiceAmount: number;
  clearingStatus: string;
}

export function toOpenItem(raw: Record<string, unknown>): OpenItem {
  const amount = Number(raw.InvoiceAmount);
  if (raw.InvoiceAmount == null || raw.InvoiceAmount === '' || !Number.isFinite(amount)) {
    throw new Error('Open item has an invalid invoice amount.');
  }
  for (const key of ['OpenItemId', 'CompanyCode', 'CustomerAccount', 'CustomerName', 'InvoiceAmountCurr', 'ClearingStatus']) {
    if (typeof raw[key] !== 'string' || !(raw[key] as string).trim()) {
      throw new Error(`Open item is missing ${key}.`);
    }
  }
  return {
    openItemId: raw.OpenItemId as string,
    postingDate: (raw.PostingDate as string | null) ?? null,
    documentDate: (raw.DocumentDate as string | null) ?? null,
    companyCode: raw.CompanyCode as string,
    customerAccount: raw.CustomerAccount as string,
    customerName: raw.CustomerName as string,
    invoiceAmountCurrency: raw.InvoiceAmountCurr as string,
    invoiceAmount: amount,
    clearingStatus: raw.ClearingStatus as string,
  };
}

export async function getOpenItems(customerAccount?: string, companyCode?: string): Promise<OpenItem[]> {
  if (process.env.CASH_S4_ENABLED !== 'true') {
    throw new Error('S/4 access is disabled. Set CASH_S4_ENABLED=true only after configuring the destination.');
  }

  const s4 = await cds.connect.to('ZAC_OPENITEMS_MOC_O4');
  const query = cds.ql.SELECT.from('ZAC_OPENITEMS_MOC_O4.zac_openitems_moc');
  const conditions: Record<string, unknown> = {};
  if (customerAccount) conditions.CustomerAccount = customerAccount;
  if (companyCode) conditions.CompanyCode = companyCode;

  if (Object.keys(conditions).length > 0) {
    query.where(conditions);
  }

  const response = await s4.run(query);
  const items = Array.isArray(response) ? response : (response as { value?: Record<string, unknown>[] })?.value;
  if (!Array.isArray(items)) {
    throw new Error('Invalid S/4 open-items response.');
  }

  // Never silently match against an incomplete candidate set
  if ((response as Record<string, unknown>)?.['@odata.nextLink']) {
    throw new Error('S/4 result is paginated; narrow the customer/company filter before matching.');
  }

  return items.map((item: Record<string, unknown>) => toOpenItem(item));
}
