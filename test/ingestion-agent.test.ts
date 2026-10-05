import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyMailboxItems } from '../srv/agents/ingestion-agent.js';
import { CLASSIFICATION_DECISION } from '../srv/constants/index.js';
import type { MailboxMessage } from '../srv/connectors/mailbox-client.js';

test('Agent 1 (Ingestion): skips already logged messages before calling AI (early deduplication)', async () => {
  let aiCalled = false;

  const messages: MailboxMessage[] = [
    {
      messageId: '<already-processed-123@acme.com>',
      subject: 'Payment advice note',
      from: 'billing@acme.com',
      bodyText: 'Payment advice enclosed.',
      attachments: [{ filename: 'advice.pdf', contentType: 'application/pdf', content: Buffer.from('dummy') }],
    },
  ];

  const results = await classifyMailboxItems({
    listMessages: async () => messages,
    hasLoggedMessage: async (id: string) => id === '<already-processed-123@acme.com>',
    generateTextWithUsage: async () => {
      aiCalled = true;
      return { content: '{"classification":"relevant","reason":"test"}' };
    },
  });

  assert.equal(aiCalled, false, 'AI must NOT be called for already logged messages');
  assert.equal(results.length, 1);
  assert.equal(results[0].isDuplicate, true);
  assert.equal(results[0].pdfAttachments.length, 0);
});

test('Agent 1 (Ingestion): skips emails without PDF attachments deterministically without calling AI', async () => {
  let aiCalled = false;

  const messages: MailboxMessage[] = [
    {
      messageId: '<newsletter@promo.com>',
      subject: 'Weekly Deals Newsletter',
      from: 'news@promo.com',
      bodyText: 'Check out our products!',
      attachments: [{ filename: 'banner.png', contentType: 'image/png', content: Buffer.from('img') }],
    },
    {
      messageId: '<text-only@client.com>',
      subject: 'Status inquiry',
      from: 'client@client.com',
      bodyText: 'Where is my order?',
      attachments: [],
    },
  ];

  const results = await classifyMailboxItems({
    listMessages: async () => messages,
    hasLoggedMessage: async () => false,
    generateTextWithUsage: async () => {
      aiCalled = true;
      return { content: '{"classification":"notRelevant","reason":"test"}' };
    },
  });

  assert.equal(aiCalled, false, 'AI must NOT be called when no PDF attachments exist');
  assert.equal(results.length, 0, 'Messages with no PDF attachments should be filtered out');
});

test('Agent 1 (Ingestion): classifies relevant email and returns PDF attachments', async () => {
  const dummyPdf = Buffer.from('%PDF-1.4 test remittance advice');

  const messages: MailboxMessage[] = [
    {
      messageId: '<valid-remittance-456@corp.com>',
      subject: 'Remittance Advice INV-1001',
      from: 'ap@corp.com',
      bodyText: 'Please allocate payment as per attached advice note.',
      attachments: [{ filename: 'remittance_1001.pdf', contentType: 'application/pdf', content: dummyPdf }],
    },
  ];

  const results = await classifyMailboxItems({
    listMessages: async () => messages,
    hasLoggedMessage: async () => false,
    generateTextWithUsage: async () => ({
      content: JSON.stringify({
        classification: 'relevant',
        reason: 'Customer email contains remittance advice for invoice allocation.',
      }),
      usage: { promptTokens: 120, completionTokens: 25, totalTokens: 145 },
      model: 'gemini-2.5-flash',
    }),
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].classification, CLASSIFICATION_DECISION.RELEVANT);
  assert.equal(results[0].pdfAttachments.length, 1);
  assert.equal(results[0].pdfAttachments[0].filename, 'remittance_1001.pdf');
  assert.equal(results[0].tokenUsage?.totalTokens, 145);
});

test('Agent 1 (Ingestion): gracefully falls back to heuristic when AI fails', async () => {
  const dummyPdf = Buffer.from('%PDF-1.4 test payment');

  const messages: MailboxMessage[] = [
    {
      messageId: '<fallback-test-789@client.com>',
      subject: 'Payment Confirmation Ref 9901',
      from: 'accounts@client.com',
      bodyText: 'Attached wire transfer payment confirmation.',
      attachments: [{ filename: 'payment_confirm.pdf', contentType: 'application/pdf', content: dummyPdf }],
    },
  ];

  const results = await classifyMailboxItems({
    listMessages: async () => messages,
    hasLoggedMessage: async () => false,
    generateTextWithUsage: async () => {
      throw new Error('AI Core Service 503 Unavailable');
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].classification, CLASSIFICATION_DECISION.RELEVANT);
  assert.ok(results[0].reason.includes('deterministic fallback'));
  assert.equal(results[0].pdfAttachments.length, 1);
});
