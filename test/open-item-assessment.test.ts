import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateOpenItemAssessment,
  allocatePaymentAmount,
  applyScoreGuardrails,
  checkExactMatch,
  companyNamesMatch,
  heuristicFallbackScores,
  parseAiMatchingResponse,
  selectAiCandidates,
  statusFromScore,
  type AssessableOpenItem,
  type AssessablePayment,
  type OpenItemMatchEvidence,
} from '../srv/agents/open-item-assessment.js';

const item = (overrides: Partial<AssessableOpenItem>): AssessableOpenItem => ({
  openItemId: 'OP-1',
  companyCode: '1000',
  customerAccount: 'CUST-01',
  customerName: 'ACME Corp',
  invoiceAmount: 1500,
  invoiceAmountCurrency: 'USD',
  clearingStatus: 'OPEN',
  ...overrides,
});

const payment = (overrides: Partial<AssessablePayment>): AssessablePayment => ({
  payer: 'ACME Corp',
  amount: 1500,
  currency: 'USD',
  references: ['OP-1'],
  ...overrides,
});

const evidence = (overrides: Partial<OpenItemMatchEvidence>): OpenItemMatchEvidence => ({
  payer: 'ACME Corp',
  paymentAmount: 1500,
  allocatedAmount: 1500,
  currency: 'USD',
  matchScore: 1,
  matchStatus: 'full',
  rationale: 'ok',
  ...overrides,
});

const ITEMS = [
  item({}),
  item({ openItemId: 'OP-2', customerName: 'TechSupplies', customerAccount: 'CUST-03', invoiceAmount: 890 }),
  item({ openItemId: 'OP-3', customerName: 'TechSupplies', customerAccount: 'CUST-03', invoiceAmount: 1200 }),
  item({ openItemId: 'OP-9', customerName: 'Old Customer', invoiceAmount: 500, clearingStatus: 'CLEARED' }),
];

test('company names match despite legal suffixes, punctuation and diacritics', () => {
  assert.ok(companyNamesMatch('ACME Corp.', 'Acme Corporation'));
  assert.ok(companyNamesMatch('Customer1 Manufacturing Ltd.', 'Customer1 Manufacturing'));
  assert.ok(companyNamesMatch('Łódź Trading Sp. z o.o.', 'Lodz Trading'));
  assert.ok(!companyNamesMatch('ACME Corp', 'TechSupplies'));
});

test('exact match: id + amount + currency + company name agree -> deterministic 100 % full', () => {
  const result = checkExactMatch(payment({}), ITEMS);
  assert.equal(result.matched, true);
  if (!result.matched) return;
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].matchScore, 1);
  assert.equal(result.candidates[0].matchStatus, 'full');
});

test('exact match: one payment covering several referenced items is still 100 %', () => {
  const result = checkExactMatch(payment({ payer: 'TechSupplies Inc.', amount: 2090, references: ['OP-2', 'OP-3'] }), ITEMS);
  assert.equal(result.matched, true);
  if (result.matched) assert.deepEqual(result.candidates.map(c => c.openItemId), ['OP-2', 'OP-3']);
});

test('exact match fails with a reason for each mismatch (currency, amount, payer, company code, cleared)', () => {
  const cases: Array<[Partial<AssessablePayment>, RegExp]> = [
    [{ currency: 'EUR' }, /waluta/],
    [{ amount: 750 }, /kwota/],
    [{ payer: 'Someone Else GmbH' }, /nazwa płatnika/],
    [{ companyCode: '2060' }, /kod spółki/],
    [{ references: [] }, /nie zawiera numerów/],
    [{ references: ['OP-404'] }, /nie istnieje/],
    [{ references: ['OP-9'], payer: 'Old Customer', amount: 500 }, /rozliczone/],
  ];
  for (const [overrides, reason] of cases) {
    const result = checkExactMatch(payment(overrides), ITEMS);
    assert.equal(result.matched, false, JSON.stringify(overrides));
    if (!result.matched) assert.match(result.problems.join('; '), reason);
  }
});

test('rule-based scores follow the 0–99 % rubric', () => {
  const score = (p: Partial<AssessablePayment>, id = 'OP-1') => heuristicFallbackScores(payment(p), ITEMS).get(id)?.score ?? 0;
  assert.equal(score({ payer: 'ACMEE Corp' }), 0.95, 'typo in the name');
  assert.equal(score({ amount: 750 }), 0.5, 'partial payment');
  assert.equal(score({ currency: 'EUR' }), 0.4, 'wrong currency');
  assert.equal(score({ references: [] }), 0.85, 'no id, but customer and amount agree');
  assert.equal(score({ references: ['OP-404'] }), 0.85, 'wrong id, customer and amount agree');
  assert.equal(score({ payer: 'Unknown', references: [], amount: 42 }), 0, 'no evidence');
  assert.ok(!heuristicFallbackScores(payment({ references: ['OP-9'] }), ITEMS).has('OP-9'), 'cleared items are never proposed');
});

test('AI candidate selection excludes cleared items and ranks the referenced item first', () => {
  const selected = selectAiCandidates(payment({ amount: 750 }), ITEMS);
  assert.equal(selected[0].openItemId, 'OP-1');
  assert.ok(!selected.some(i => i.openItemId === 'OP-9'));
});

test('AI response parsing: fenced JSON, unknown ids dropped, scores clamped to 0.99', () => {
  const raw = '```json\n{"matches":[{"openItemId":"OP-1","confidence":1.2,"reason":"literówka"},{"openItemId":"OP-X","confidence":0.9},{"openItemId":"OP-2","confidence":0}],"rationale":"ok"}\n```';
  const parsed = parseAiMatchingResponse(raw, ['OP-1', 'OP-2']);
  assert.ok(parsed);
  assert.deepEqual(parsed.matches, [{ openItemId: 'OP-1', confidence: 0.99, reason: 'literówka' }]);
  assert.equal(parsed.rationale, 'ok');
  assert.equal(parseAiMatchingResponse('{"matchedCustomerAccounts":[]}', ['OP-1']), null);
  assert.equal(parseAiMatchingResponse('not json', ['OP-1']), null);
});

test('guardrail caps AI scores for unrelated, unreferenced items', () => {
  const unrelated = item({ openItemId: 'OP-7', customerName: 'Totally Different Ltd' });
  assert.equal(applyScoreGuardrails(payment({ references: [] }), unrelated, 0.9), 0.45);
  assert.equal(applyScoreGuardrails(payment({}), ITEMS[0], 0.9), 0.9);
});

test('score -> status mapping', () => {
  assert.equal(statusFromScore(1, true), 'full');
  assert.equal(statusFromScore(0.99), 'probable');
  assert.equal(statusFromScore(0.5), 'toBeChecked');
  assert.equal(statusFromScore(0), 'noMatch');
});

test('payment allocation is proportional for multi-item payments', () => {
  assert.equal(allocatePaymentAmount(1500, 1500, [1500]), 1500);
  assert.equal(allocatePaymentAmount(2090, 890, [890, 1200]), 890);
  assert.equal(allocatePaymentAmount(1045, 1200, [890, 1200]), 600);
});

test('open item assessment: no payment advice -> 0 % noMatch', () => {
  const result = aggregateOpenItemAssessment(ITEMS[0], []);
  assert.equal(result.aiConfidence, 0);
  assert.equal(result.aiMatchStatus, 'noMatch');
  assert.match(result.aiRationale, /Brak awizo/);
});

test('open item assessment: best evidence wins, partial payment stays around 50 %', () => {
  const result = aggregateOpenItemAssessment(ITEMS[0], [
    evidence({ matchScore: 0.5, matchStatus: 'toBeChecked', paymentAmount: 750, allocatedAmount: 750 }),
  ]);
  assert.equal(result.aiConfidence, 0.5);
  assert.equal(result.aiMatchStatus, 'toBeChecked');
  assert.equal(result.matchedAmount, 750);
});

test('open item assessment: item paid in two instalments -> close to 99 %', () => {
  const result = aggregateOpenItemAssessment(ITEMS[0], [
    evidence({ matchScore: 0.5, matchStatus: 'toBeChecked', paymentAmount: 750, allocatedAmount: 750 }),
    evidence({ matchScore: 0.5, matchStatus: 'toBeChecked', paymentAmount: 750, allocatedAmount: 750 }),
  ]);
  assert.equal(result.aiConfidence, 0.97);
  assert.equal(result.aiMatchStatus, 'probable');
  assert.equal(result.matchedPaymentCount, 2);
  assert.match(result.aiRationale, /2 płatnościach/);
});

test('open item assessment: deterministic full match -> 100 %', () => {
  const result = aggregateOpenItemAssessment(ITEMS[0], [evidence({})]);
  assert.equal(result.aiConfidence, 1);
  assert.equal(result.aiMatchStatus, 'full');
});
