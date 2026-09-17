// Temporary local substitutes for the missing GenAI and S/4 clients.
// No PDF processing, network calls or real customer resolution take place.

export interface OpenItem {
  openItemId: string;
  companyCode: string;
  customerAccount: string;
  customerName: string;
  invoiceAmount: number;
  invoiceAmountCurrency: string;
  clearingStatus: string;
}

export async function extractDocument(_pdfBuffer: Buffer, _prompt: string): Promise<string> {
  return JSON.stringify({
    payer: '[MOCK] Test payer — PDF not processed',
    amount: 0,
    currency: 'USD',
    valueDate: '2000-01-01',
    references: [],
    extractionConfidence: 0,
  });
}

export async function generateText(_prompt: string): Promise<string> {
  return JSON.stringify({
    matchedCustomerAccounts: [],
    rationale: '[MOCK] GenAI client is unavailable; no customer resolution was performed.',
  });
}
