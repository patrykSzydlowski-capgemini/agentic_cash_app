// Adapted from AlexanderX/ts-agentic-poc (Apache-2.0), srv/s4/clearing-client.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postClearing, type ClearingMatch, type HttpPost } from '../srv/s4/clearing-client.js';

function fakePostingRecord(overrides: Record<string, unknown> = {}) {
  return {
    PostingId: 'fake-posting-id',
    OpenItemId: '0000000000',
    company_code: '2060',
    Amount: 0,
    Currency: 'EUR',
    Customer: '000000000',
    PostingDate: null,
    Status: '',
    DocumentNumber: '',
    CreatedAt: null,
    SAP__Messages: [],
    ...overrides,
  };
}

test('postClearing: single match calls create then simulate once each', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const httpPost: HttpPost = async (url, body) => {
    calls.push({ url, body });
    if (calls.length === 1) {
      return fakePostingRecord({ PostingId: 'posting-1', OpenItemId: '0123456789' });
    }
    return fakePostingRecord({
      PostingId: 'posting-1',
      OpenItemId: '0123456789',
      Status: 'POSTED',
      DocumentNumber: 'DOC0001',
    });
  };

  const matches: ClearingMatch[] = [
    { openItemId: '0123456789', companyCode: '2060', amount: 1000, currency: 'EUR', customer: '223322223' },
  ];

  const results = await postClearing(matches, httpPost);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/Postings$/);
  assert.match(calls[1].url, /\/Postings\(posting-1\)\/.*\.simulatePosting$/);
  assert.deepEqual(calls[0].body, {
    OpenItemId: '0123456789',
    company_code: '2060',
    Amount: 1000,
    Currency: 'EUR',
    Customer: '223322223',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].postingId, 'posting-1');
  assert.equal(results[0].status, 'POSTED');
  assert.equal(results[0].documentNumber, 'DOC0001');
  assert.deepEqual(results[0].sapMessages, []);
});

test('postClearing: two matches call create+simulate independently for each, in order', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const httpPost: HttpPost = async (url, body) => {
    calls.push({ url, body });
    const isCreate = !url.includes('simulatePosting');
    const openItemId = (body as { OpenItemId?: string }).OpenItemId ?? (calls.length <= 2 ? '0123456789' : '0123456790');
    const postingId = openItemId === '0123456789' ? 'posting-1' : 'posting-2';
    return fakePostingRecord({
      PostingId: postingId,
      OpenItemId: openItemId,
      Status: isCreate ? '' : 'POSTED',
      DocumentNumber: isCreate ? '' : `DOC-${postingId}`,
    });
  };

  const matches: ClearingMatch[] = [
    { openItemId: '0123456789', companyCode: '2060', amount: 1000, currency: 'EUR', customer: '223322223' },
    { openItemId: '0123456790', companyCode: '2060', amount: 2000, currency: 'EUR', customer: '223322224' },
  ];

  const results = await postClearing(matches, httpPost);

  assert.equal(calls.length, 4);
  // create(item1), simulate(item1), create(item2), simulate(item2) — sequential, not interleaved.
  assert.match(calls[0].url, /\/Postings$/);
  assert.match(calls[1].url, /posting-1.*simulatePosting$/);
  assert.match(calls[2].url, /\/Postings$/);
  assert.match(calls[3].url, /posting-2.*simulatePosting$/);

  assert.equal(results.length, 2);
  assert.equal(results[0].postingId, 'posting-1');
  assert.equal(results[0].documentNumber, 'DOC-posting-1');
  assert.equal(results[1].postingId, 'posting-2');
  assert.equal(results[1].documentNumber, 'DOC-posting-2');
});
