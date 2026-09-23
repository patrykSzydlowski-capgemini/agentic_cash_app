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
      // @ts-expect-error @sap/xsenv does not bundle type declarations
      const xsenv = (await import('@sap/xsenv')).default;
      xsenv.loadEnv();
    } catch {
      // ignore
    }
  }
  const { executeHttpRequest } = await import('@sap-cloud-sdk/http-client');
  const response = await executeHttpRequest(
    { destinationName: process.env.S4_DESTINATION_NAME ?? 'HD0_BAS' },
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

export async function getOpenItems(
  customerAccount?: string,
  companyCode?: string,
  httpGet: HttpGet = defaultHttpGet,
): Promise<OpenItem[]> {
  if (process.env.CASH_S4_ENABLED !== 'true') {
    throw new Error('S/4 access is disabled. Set CASH_S4_ENABLED=true only after configuring the destination.');
  }

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

  return items.map((item: Record<string, unknown>) => toOpenItem(item));
}
