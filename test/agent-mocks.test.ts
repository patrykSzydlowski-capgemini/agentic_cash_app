import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPayment } from '../srv/agents/extraction-agent.js';
import { proposeMatches } from '../srv/agents/matching-agent.js';
import { extractDocument, generateText, type OpenItem } from '../srv/agents/integration-mocks.js';

test('mock extraction returns explicitly synthetic data with zero confidence', async () => {
  const payment = await extractPayment(Buffer.from('not a real PDF'), extractDocument);
  assert.match(payment.payer, /\[MOCK\]/);
  assert.equal(payment.extractionConfidence, 0);
  assert.equal(payment.amount, 0);
  assert.deepEqual(payment.references, []);
  assert.equal(payment.valueDate, '2000-01-01');
});

test('mock payer resolution does not invent a customer match', async () => {
  const payment = await extractPayment(Buffer.alloc(0), extractDocument);
  const item: OpenItem = {
    openItemId: 'TEST-1', companyCode: '1000', customerAccount: 'TEST-CUSTOMER',
    customerName: payment.payer, invoiceAmount: 0, invoiceAmountCurrency: 'USD',
    clearingStatus: 'OPEN',
  };
  const matches = await proposeMatches(payment, [item], generateText);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchStatus, 'noMatch');
  assert.equal(matches[0].matchScore, 0);
  assert.match(matches[0].rationale, /\[MOCK\]/);
});

test('exact match: referenced invoice with equal amount gives 100% score (full match) deterministically', async () => {
  let llmCalled = false;
  const mockGenerateText = async () => {
    llmCalled = true;
    return JSON.stringify({ matchedCustomerAccounts: [], rationale: 'LLM should not be called' });
  };

  const payment = {
    payer: 'ACME Corp',
    amount: 1500.00,
    currency: 'USD',
    valueDate: '2026-03-01',
    references: ['INV-1001', 'PO-999'],
    extractionConfidence: 0.95,
  };

  const item: OpenItem = {
    openItemId: 'INV-1001',
    companyCode: '1000',
    customerAccount: 'CUST-001',
    customerName: 'ACME Corporation',
    invoiceAmount: 1500.00,
    invoiceAmountCurrency: 'USD',
    clearingStatus: 'OPEN',
  };

  const matches = await proposeMatches(payment, [item], mockGenerateText as any);
  assert.equal(llmCalled, false, 'LLM must not be called when reference and amount match exactly');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchStatus, 'full');
  assert.equal(matches[0].matchScore, 1);
  assert.match(matches[0].rationale, /matches the payment exactly/);
});

test('partial payment: referenced invoice with smaller amount gives 50% score (toBeChecked)', async () => {
  let llmCalled = false;
  const mockGenerateText = async () => {
    llmCalled = true;
    return JSON.stringify({ matchedCustomerAccounts: [], rationale: 'LLM should not be called' });
  };

  const payment = {
    payer: 'ACME Corp',
    amount: 750.00,
    currency: 'USD',
    valueDate: '2026-03-01',
    references: ['INV-1001'],
    extractionConfidence: 0.95,
  };

  const item: OpenItem = {
    openItemId: 'INV-1001',
    companyCode: '1000',
    customerAccount: 'CUST-001',
    customerName: 'ACME Corporation',
    invoiceAmount: 1500.00,
    invoiceAmountCurrency: 'USD',
    clearingStatus: 'OPEN',
  };

  const matches = await proposeMatches(payment, [item], mockGenerateText as any);
  assert.equal(llmCalled, false, 'LLM must not be called when reference is present');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchStatus, 'toBeChecked');
  assert.equal(matches[0].matchScore, 0.5);
  assert.match(matches[0].rationale, /partial payment/);
});

test('no reference: invokes LLM to resolve customer by payer name', async () => {
  let llmCalled = false;
  const mockGenerateText = async () => {
    llmCalled = true;
    return JSON.stringify({
      matchedCustomerAccounts: ['CUST-001'],
      rationale: 'Payer "ACME Corp" matches customer "ACME Corporation".',
    });
  };

  const payment = {
    payer: 'ACME Corp',
    amount: 1500.00,
    currency: 'USD',
    valueDate: '2026-03-01',
    references: [], // No references
    extractionConfidence: 0.90,
  };

  const item: OpenItem = {
    openItemId: 'INV-1001',
    companyCode: '1000',
    customerAccount: 'CUST-001',
    customerName: 'ACME Corporation',
    invoiceAmount: 1500.00,
    invoiceAmountCurrency: 'USD',
    clearingStatus: 'OPEN',
  };

  const matches = await proposeMatches(payment, [item], mockGenerateText as any);
  assert.equal(llmCalled, true, 'LLM must be invoked when no reference is found');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchStatus, 'probable');
  assert.equal(matches[0].matchScore, 0.75);
  assert.equal(matches[0].rationale, 'Payer "ACME Corp" matches customer "ACME Corporation".');
});

test('overpayment: referenced invoice with larger amount gives 50% score (toBeChecked) and notes overpayment percentage', async () => {
  const payment = {
    payer: 'ACME Corp',
    amount: 1800.00,
    currency: 'USD',
    valueDate: '2026-03-01',
    references: ['INV-1001'],
    extractionConfidence: 0.95,
  };

  const item: OpenItem = {
    openItemId: 'INV-1001',
    companyCode: '1000',
    customerAccount: 'CUST-001',
    customerName: 'ACME Corporation',
    invoiceAmount: 1500.00,
    invoiceAmountCurrency: 'USD',
    clearingStatus: 'OPEN',
  };

  const matches = await proposeMatches(payment, [item]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchStatus, 'toBeChecked');
  assert.equal(matches[0].matchScore, 0.5);
  assert.match(matches[0].rationale, /overpayment/);
  assert.match(matches[0].rationale, /120%/);
});


