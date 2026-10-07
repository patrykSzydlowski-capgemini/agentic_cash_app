// Adapted from AlexanderX/ts-agentic-poc (Apache-2.0).
// Destination-backed S/4 read adapter via @sap-cloud-sdk/http-client (HD0_BAS).

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

export type HttpGet = (url: string) => Promise<unknown>;

async function defaultHttpGet(url: string): Promise<unknown> {
  if (!process.env.VCAP_SERVICES) {
    try {
      // @ts-ignore
      const xsenv = (await import('@sap/xsenv')).default;
      xsenv.loadEnv();
    } catch { /* ignore if default-env.json missing */ }
  }
  const { executeHttpRequest } = await import('@sap-cloud-sdk/http-client');
  const cdsS4 = (global as any).cds?.env?.requires?.s4;
  const destinationName = process.env.S4_DESTINATION_NAME ?? cdsS4?.credentials?.destination ?? 'HD0_BAS';
  const response = await executeHttpRequest(
    { destinationName },
    {
      method: 'get',
      url,
      headers: { Accept: 'application/json' },
      timeout: 30000,
    },
  );
  return response.data;
}

const OPEN_ITEMS_PATH =
  '/sap/opu/odata4/sap/zac_openitems_moc_o4/srvd_a2x/sap/zac_openitems_moc/0001/zac_openitems_moc';
const POSTING_PATH =
  '/sap/opu/odata4/sap/zac_posting_moc_o4/srvd_a2x/sap/zac_posting_moc/0001/Postings';

const KNOWN_CUSTOMERS: Record<string, string> = {
  '223322223': 'Customer1 Manufacturing Ltd.',
  '223322224': 'Customer2 Ltd.',
  '223322225': 'Customer3 Inc.',
  '223322555': 'Friends and Foes US',
  '223377555': 'Garfild Inc.',
  '333377555': 'TechSupplies',
  'CUST-01': 'ACME Corp',
  'CUST-03': 'TechSupplies',
  'CUST-04': 'Retail Partners',
  'CUST-10': 'Customer1 Manufacturing Ltd.',
};

export async function getOpenItems(
  customerAccount?: string,
  companyCode?: string,
  httpGet: HttpGet = defaultHttpGet,
): Promise<OpenItem[]> {

  const filters: string[] = [];
  if (customerAccount) filters.push(`CustomerAccount eq '${customerAccount}'`);
  if (companyCode) filters.push(`CompanyCode eq '${companyCode}'`);

  const url =
    filters.length > 0
      ? `${OPEN_ITEMS_PATH}?${encodeURI('$filter=' + filters.join(' and '))}`
      : OPEN_ITEMS_PATH;

  const data = (await httpGet(url)) as
    | { value?: Record<string, unknown>[]; '@odata.nextLink'?: string }
    | Record<string, unknown>[];
  const items = Array.isArray(data) ? data : data?.value;
  if (!Array.isArray(items)) {
    throw new Error('Invalid S/4 open-items response.');
  }

  // Never silently match against an incomplete candidate set
  if (!Array.isArray(data) && data?.['@odata.nextLink']) {
    throw new Error('S/4 result is paginated; narrow the customer/company filter before matching.');
  }

  const openMap = new Map<string, OpenItem>();
  for (const item of items) {
    const parsed = toOpenItem(item);
    openMap.set(parsed.openItemId, parsed);
  }

  // Also query Postings service to load cleared/posted items from S/4HANA (both open and cleared)
  try {
    const postFilters: string[] = [];
    if (customerAccount) postFilters.push(`Customer eq '${customerAccount}'`);
    if (companyCode) postFilters.push(`company_code eq '${companyCode}'`);

    const postUrl =
      postFilters.length > 0
        ? `${POSTING_PATH}?${encodeURI('$filter=' + postFilters.join(' and '))}`
        : POSTING_PATH;

    const postData = (await httpGet(postUrl)) as
      | { value?: Record<string, unknown>[] }
      | Record<string, unknown>[];
    const postItems = Array.isArray(postData) ? postData : postData?.value;

    if (Array.isArray(postItems)) {
      for (const p of postItems) {
        const id = p.OpenItemId ? String(p.OpenItemId).trim() : '';
        if (!id) continue;
        if (openMap.has(id)) {
          const existing = openMap.get(id)!;
          existing.clearingStatus = 'CLEARED';
        } else {
          const cust = String(p.Customer || '').trim();
          const custName = KNOWN_CUSTOMERS[cust] || (cust ? `Customer ${cust}` : 'Customer');
          openMap.set(id, {
            openItemId: id,
            postingDate: (p.PostingDate as string | null) ?? null,
            documentDate: (p.CreatedAt as string | null) ?? null,
            companyCode: (p.company_code as string) || companyCode || '2060',
            customerAccount: cust,
            customerName: custName,
            invoiceAmountCurrency: String(p.Currency || 'USD'),
            invoiceAmount: Number(p.Amount || 0),
            clearingStatus: 'CLEARED',
          });
        }
      }
    }
  } catch {
    // Proceed with items from OPEN_ITEMS_PATH if Postings service is unreachable or in tests
  }

  return Array.from(openMap.values());
}
