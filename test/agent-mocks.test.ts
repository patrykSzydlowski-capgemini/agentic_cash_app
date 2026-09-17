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
