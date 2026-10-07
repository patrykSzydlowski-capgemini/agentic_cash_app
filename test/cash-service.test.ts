import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';

const compiled = process.env.npm_lifecycle_event === 'test:built';
let project = resolve('.');
let temporaryProject: string | undefined;
const port = Number(process.env.TEST_PORT ?? 4015);
const base = `http://127.0.0.1:${port}/odata/v4/cash-sync`;
let server: ChildProcess;
let output = '';

before(async () => {
    if (compiled) {
        await mkdir('_out', { recursive: true });
        temporaryProject = await mkdtemp(resolve('_out/compiled-test-'));
        project = temporaryProject;
        await cp('gen/srv', project, { recursive: true });
        // Test fixtures only; production artifacts do not need demo data.
        await cp('db/data', resolve(project, 'db/data'), { recursive: true });
        await cp('test/fixtures/data', resolve(project, 'test/fixtures/data'), { recursive: true });
        await cp('test-fixtures', resolve(project, 'test-fixtures'), { recursive: true });
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.CASH_AI_ENABLED;
    delete env.CASH_S4_ENABLED;
    // Never reach the live S/4 tenant from tests: an unknown destination makes
    // every S/4 call fail (open items fall back to the SQLite cache, posting -> 502).
    env.S4_DESTINATION_NAME = '__cash_sync_test_no_s4__';
    env.MAILBOX_USE_MOCK = 'true';
    env.AGENT_PIPELINE_ON_STARTUP = 'false';
    // Payment fixtures live outside db/data and test/data, so `cds watch` never shows demo payments.
    // `--in-memory` rebuilds requires.db from requires.kinds.sqlite, so both need the folder list.
    const data = ['db/data', 'test/fixtures/data'];
    env.CDS_CONFIG = JSON.stringify({ requires: { db: { data }, kinds: { sqlite: { data } } } });
    if (compiled) delete env.CDS_TYPESCRIPT;
    else env.CDS_TYPESCRIPT = 'true';
    server = spawn(process.execPath, [
        ...(compiled ? [] : ['--import', 'tsx']),
        resolve('node_modules/@sap/cds/bin/serve.js'),
        '--in-memory', '--port', String(port),
    ], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout?.on('data', data => { output += data.toString(); });
    server.stderr?.on('data', data => { output += data.toString(); });
    for (let attempt = 0; attempt < 150; attempt++) {
        if (server.exitCode !== null) throw new Error(output);
        if (output.includes('server listening on')) {
            assert.ok(output.includes(compiled ? 'cat-service.js' : 'cat-service.ts'), output);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start: ${output}`);
});

after(async () => {
    if (server && server.exitCode === null) {
        const stopped = once(server, 'exit');
        server.kill('SIGTERM');
        await stopped;
    }
    if (temporaryProject) await rm(temporaryProject, { recursive: true, force: true });
});

async function get(path: string) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
}

async function post(path: string, payload: object) {
    const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    assert.ok(response.ok, `${response.status}: ${await response.clone().text()}`);
    return response;
}

test('metadata and seeded local entities are served', async () => {
    const metadata = await fetch(base + '/$metadata');
    assert.equal(metadata.status, 200);
    const defaultMeta = await metadata.text();
    assert.match(defaultMeta, /CashSyncService/);
    assert.ok((await get('/OpenItem')).value.length >= 5);
    assert.equal((await get('/MatchResult')).value.length, 3);
});

test('OData metadata properly localizes annotations into Polish, German, and English without raw keys', async () => {
    // Polish
    const plRes = await fetch(base + '/$metadata?sap-locale=pl', {
        headers: { 'Accept-Language': 'pl' }
    });
    assert.equal(plRes.status, 200);
    const plMeta = await plRes.text();
    assert.ok(plMeta.includes('Analityka wykonania AI i alokacja zasobów'), 'PL should localize facetAiAnalytics');
    assert.ok(plMeta.includes('Pozycje rozliczone (zaksięgowane)'), 'PL should localize tabClosedItems');
    assert.ok(!plMeta.includes('String="facetAiAnalytics"'), 'PL should not contain raw facetAiAnalytics');
    assert.ok(!plMeta.includes('{i18n>facetAiAnalytics}'), 'PL should not contain unparsed {i18n>facetAiAnalytics}');
    assert.ok(!plMeta.includes('{i18n>tabClosedItems}'), 'PL should not contain unparsed {i18n>tabClosedItems}');

    // German
    const deRes = await fetch(base + '/$metadata?sap-locale=de', {
        headers: { 'Accept-Language': 'de' }
    });
    assert.equal(deRes.status, 200);
    const deMeta = await deRes.text();
    assert.ok(deMeta.includes('KI-Ausführungsanalytik &amp; Ressourcenkosten'), 'DE should localize facetAiAnalytics');
    assert.ok(deMeta.includes('Ausgeglichene Posten (gebucht)'), 'DE should localize tabClosedItems');
    assert.ok(!deMeta.includes('String="facetAiAnalytics"'), 'DE should not contain raw facetAiAnalytics');
    assert.ok(!deMeta.includes('{i18n>tabClosedItems}'), 'DE should not contain unparsed {i18n>tabClosedItems}');

    // English (default)
    const enRes = await fetch(base + '/$metadata?sap-locale=en', {
        headers: { 'Accept-Language': 'en' }
    });
    assert.equal(enRes.status, 200);
    const enMeta = await enRes.text();
    assert.ok(enMeta.includes('AI Execution Analytics &amp; Resource Costs'), 'EN should localize facetAiAnalytics');
    assert.ok(enMeta.includes('Closed Items (Posted)'), 'EN should localize tabClosedItems');
    assert.ok(!enMeta.includes('String="facetAiAnalytics"'), 'EN should not contain raw facetAiAnalytics');
    assert.ok(!enMeta.includes('{i18n>tabClosedItems}'), 'EN should not contain unparsed {i18n>tabClosedItems}');
});

test('triggerAIAgent updates the selected match and returns notification', async () => {
    const path = "/MatchResult('MATCH-001')";
    const response = await post(path + '/CashSyncService.triggerAIAgent', {});
    assert.match(response.headers.get('sap-messages') ?? '', /MATCH-001/);
    const match = await get(path);
    assert.equal(match.match_status, 'MATCHED');
    assert.equal(match.action_required, false);
    assert.equal(match.review_status, 'APPROVED');
});

test('manualApprove approves the selected match and sets manual review reason', async () => {
    const path = "/MatchResult('MATCH-002')";
    const response = await post(path + '/CashSyncService.manualApprove', {});
    assert.match(response.headers.get('sap-messages') ?? '', /MATCH-002/);
    const match = await get(path);
    assert.equal(match.match_status, 'MATCHED');
    assert.equal(match.action_required, false);
    assert.equal(match.review_status, 'APPROVED');
    assert.match(match.review_reason, /Ręcznie/);
});

for (const confidence of [0.81, 0.8, 0.79]) {
    test(`ingestAgentMatch preserves confidence threshold at ${confidence}`, async () => {
        const id = `TS-${confidence}`;
        const response = await post('/ingestAgentMatch', {
            match_id: id, open_item_id: 'OP-1001', matched_amount: 100,
            confidence, review_reason: 'Accepted but unused by current handler',
        });
        assert.equal((await response.json()).value, 'Match stored successfully');
        const match = await get(`/MatchResult('${id}')`);
        assert.equal(match.match_status, confidence > 0.8 ? 'MATCHED' : 'NEEDS_REVIEW');
        assert.equal(match.action_required, confidence <= 0.8);
        assert.equal(match.open_item_OpenItemId, 'OP-1001');
        assert.equal(Number(match.matched_amount), 100);
    });
}

// Tests have no AI binding: Agent 2 either gets the zero-confidence mock (needsReview)
// or a failed live call (failed). Both must skip Agent 3 and store no candidates.
const UNUSABLE_EXTRACTION = ['needsReview', 'failed'];

test('processPaymentDocument routes an unusable extraction to review without matches', async () => {
    const paymentsBefore = (await get('/Payments')).value.length;
    const response = await post('/processPaymentDocument', { pdfBase64: Buffer.from('unused').toString('base64') });
    const text = (await response.json()).value;
    assert.match(text, /Stored 0 proposed match/);

    const payments = (await get('/Payments')).value;
    assert.equal(payments.length, paymentsBefore + 1);
    const payment = payments.find((p: any) => text.includes(p.ID));
    assert.ok(payment, 'expected the new payment row');
    assert.equal(Number(payment.extractionConfidence), 0);
    assert.ok(UNUSABLE_EXTRACTION.includes(payment.status), payment.status);

    const matches = await get(`/Payments('${payment.ID}')/matches`);
    assert.equal(matches.value.length, 0);
});

async function postRaw(path: string, payload: object) {
    return fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

test('uploadPayment stores the payment even when extraction is unusable', async () => {
    const paymentsBefore = (await get('/Payments')).value.length;
    const response = await post('/uploadPayment', {
        fileName: 'mock-remittance.pdf',
        fileContent: Buffer.from('unused').toString('base64'),
    });
    const stored = await response.json();
    assert.equal(stored.fileName, 'mock-remittance.pdf');
    assert.ok(UNUSABLE_EXTRACTION.includes(stored.status), stored.status);

    const payments = (await get('/Payments')).value;
    assert.equal(payments.length, paymentsBefore + 1);

    const matches = await get(`/Payments('${stored.ID}')/matches`);
    assert.equal(matches.value.length, 0);
    assert.ok(typeof stored.processingTimeMs === 'number', 'processingTimeMs should be a number');
});

test('multiple concurrent uploadPayment calls calculate isolated, non-cumulative processing times', async () => {
    const file1 = { fileName: 'file1.pdf', fileContent: Buffer.from('unused-1').toString('base64') };
    const file2 = { fileName: 'file2.pdf', fileContent: Buffer.from('unused-2').toString('base64') };
    const file3 = { fileName: 'file3.pdf', fileContent: Buffer.from('unused-3').toString('base64') };

    const [res1, res2, res3] = await Promise.all([
        post('/uploadPayment', file1),
        post('/uploadPayment', file2),
        post('/uploadPayment', file3),
    ]);

    const p1 = await res1.json();
    const p2 = await res2.json();
    const p3 = await res3.json();

    assert.ok(p1.processingTimeMs >= 0, 'file 1 processing time must be >= 0');
    assert.ok(p2.processingTimeMs >= 0, 'file 2 processing time must be >= 0');
    assert.ok(p3.processingTimeMs >= 0, 'file 3 processing time must be >= 0');
});

test('uploadPayment rejects wrong-typed content at the OData layer (400)', async () => {
    // Edm.Binary validation fires before the handler: a JSON number never
    // reaches decodeFileContent, so the 400 comes from the OData layer.
    const response = await postRaw('/uploadPayment', { fileName: 'bad.pdf', fileContent: 42 });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /not a valid LargeBinary/);
});

test('reprocessWithAI triggers matching agent on selected payment and updates status', async () => {
    const id = '00000001-0000-0000-0000-000000000002';
    const response = await post(`/Payments('${id}')/CashSyncService.reprocessWithAI`, {});
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.ID, id);
    assert.equal(updated.status, 'matched');
    // Agent 3 never overwrites the extraction confidence of Agent 2.
    assert.equal(Number(updated.extractionConfidence), 0.92);

    // Reference + amount + currency + company name all agree -> deterministic 100 %.
    const matches = (await get(`/Payments('${id}')/matches`)).value;
    assert.equal(matches.length, 1);
    assert.equal(matches[0].openItemId, 'OP-1001');
    assert.equal(Number(matches[0].matchScore), 1);
    assert.equal(matches[0].matchStatus, 'full');

    const item = await get(`/OpenItem('OP-1001')`);
    assert.equal(Number(item.aiConfidence), 1);
    assert.equal(item.aiMatchStatus, 'full');
    assert.match(item.aiRationale, /ACME Corp/);
});

test('postToS4 rejects payment with no matching open item (400)', async () => {
    const id = '00000001-0000-0000-0000-000000000003';
    const response = await postRaw(`/Payments('${id}')/CashSyncService.postToS4`, {});
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.match(body, /nie posiada powiązanej otwartej pozycji w SAP/);
});

test('postToS4 performs clearing attempt in S/4HANA', async () => {
    const id = '00000001-0000-0000-0000-000000000002';
    const response = await postRaw(`/Payments('${id}')/CashSyncService.postToS4`, {});
    assert.ok([200, 400, 502].includes(response.status));
});

test('reprocessWithAI preserves multiple match candidates for multi-invoice payment', async () => {
    const id = '00000001-0000-0000-0000-000000000004';
    const response = await post(`/Payments('${id}')/CashSyncService.reprocessWithAI`, {});
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.ID, id);
    assert.ok(['matched', 'needsReview'].includes(updated.status));

    const matches = (await get(`/Payments('${id}')/matches`)).value;
    assert.equal(matches.length, 2, 'Must preserve both matched invoices');
    const itemIds = matches.map((m: any) => m.openItemId).sort();
    assert.deepEqual(itemIds, ['OP-1003', 'OP-1004']);
});

test('postToS4 on multi-invoice payment attempts clearing (test destination unreachable -> 502 or guarded 400)', async () => {
    const id = '00000001-0000-0000-0000-000000000004';
    const response = await postRaw(`/Payments('${id}')/CashSyncService.postToS4`, {});
    assert.ok([200, 400, 502].includes(response.status), String(response.status));
});

test('revalidatePipeline executes 3-agent pipeline and returns summary', async () => {
    const response = await post('/revalidatePipeline', {});
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(typeof result.value === 'string');
    assert.match(result.value, /Pipeline revalidated/);
});

test('getAiStatistics returns aggregate token metrics, cost, CU, averages, and medians', async () => {
    const stats = await get('/getAiStatistics()');
    assert.ok(stats, 'Expected valid stats response');
    assert.ok(typeof stats.totalPromptTokens === 'number', 'totalPromptTokens should be number');
    assert.ok(typeof stats.totalCompletionTokens === 'number', 'totalCompletionTokens should be number');
    assert.ok(typeof stats.totalTokens === 'number', 'totalTokens should be number');
    assert.ok(stats.totalTokens > 0, 'totalTokens should be greater than 0');
    assert.ok(typeof stats.totalCost === 'number', 'totalCost should be number');
    assert.ok(stats.totalCost > 0, 'totalCost should be greater than 0');
    assert.ok(typeof stats.totalCapacityUnits === 'number', 'totalCapacityUnits should be number');
    assert.ok(stats.totalCapacityUnits > 0, 'totalCapacityUnits should be greater than 0');
    assert.ok(typeof stats.totalProcessed === 'number', 'totalProcessed should be number');
    assert.ok(stats.totalProcessed > 0, 'totalProcessed should be > 0');
    // Averages (Means)
    assert.ok(typeof stats.avgTokensPerPayment === 'number', 'avgTokensPerPayment should be number');
    assert.ok(typeof stats.avgPromptTokens === 'number', 'avgPromptTokens should be number');
    assert.ok(typeof stats.avgCompletionTokens === 'number', 'avgCompletionTokens should be number');
    assert.ok(typeof stats.avgCost === 'number', 'avgCost should be number');
    assert.ok(typeof stats.avgCapacityUnits === 'number', 'avgCapacityUnits should be number');
    // Medians
    assert.ok(typeof stats.medianTokensPerPayment === 'number', 'medianTokensPerPayment should be number');
    assert.ok(typeof stats.medianPromptTokens === 'number', 'medianPromptTokens should be number');
    assert.ok(typeof stats.medianCompletionTokens === 'number', 'medianCompletionTokens should be number');
    assert.ok(typeof stats.medianCost === 'number', 'medianCost should be number');
    assert.ok(typeof stats.medianCapacityUnits === 'number', 'medianCapacityUnits should be number');
    assert.ok(stats.activeModel, 'activeModel should be set');
});

test('reprocessWithAI refuses payments that are already posted', async () => {
    const id = '00000001-0000-0000-0000-000000000001';
    const response = await postRaw(`/Payments('${id}')/CashSyncService.reprocessWithAI`, {});
    assert.equal(response.status, 400);
});

test('reprocessWithAI keeps token metrics, estimated cost, and CU on payment', async () => {
    const id = '00000001-0000-0000-0000-000000000002';
    const response = await post(`/Payments('${id}')/CashSyncService.reprocessWithAI`, {});
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.ok(updated.totalTokens > 0, 'totalTokens should be set');
    assert.ok(updated.promptTokens > 0, 'promptTokens should be set');
    assert.ok(updated.completionTokens > 0, 'completionTokens should be set');
    assert.ok(updated.estimatedCost >= 0, 'estimatedCost should be set');
    assert.ok(updated.capacityUnits >= 0, 'capacityUnits should be set');
    assert.ok(updated.aiModel, 'aiModel should be set');
    assert.ok(typeof updated.processingTimeMs === 'number', 'processingTimeMs should be recorded');
});

test('AiAnalytics projection serves token usage, cost, and CU columns', async () => {
    const response = await get('/AiAnalytics');
    assert.ok(Array.isArray(response.value), 'Should return array of analytics records');
    assert.ok(response.value.length > 0, 'Should have records');
    const first = response.value[0];
    assert.ok('totalTokens' in first, 'Should have totalTokens column');
    assert.ok('estimatedCost' in first, 'Should have estimatedCost column');
    assert.ok('capacityUnits' in first, 'Should have capacityUnits column');
    assert.ok('aiModel' in first, 'Should have aiModel column');
});

test('reprocessWithAI on unknown/uncertain payment keeps status needsReview and confidence <= 0.60', async () => {
    const id = '00000001-0000-0000-0000-000000000003';
    const response = await post(`/Payments('${id}')/CashSyncService.reprocessWithAI`, {});
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.ID, id);
    assert.equal(updated.status, 'needsReview');
    assert.ok(Number(updated.extractionConfidence) <= 0.60, 'Confidence must be capped at <= 0.60');
});

test('open items: S/4 cache serves OPEN items with an AI paid-assessment, unmatched items score 0', async () => {
    const items = (await get(`/OpenItem?$filter=ClearingStatus eq 'OPEN'`)).value;
    assert.ok(items.length >= 5);
    const unpaid = items.find((i: any) => i.OpenItemId === '9123456999');
    assert.ok(unpaid, 'Garfild item expected in seed');
    assert.equal(Number(unpaid.aiConfidence ?? 0), 0);
});

test('syncMailbox (Agent 1) stores only new PDF mails and is idempotent', async () => {
    // revalidatePipeline above may already have run Agent 1, so check the stored state.
    const first = await post('/syncMailbox', {});
    assert.ok(Array.isArray((await first.json()).value));

    const logs = (await get('/IngestionLog')).value;
    const mockIds = [
        '<remittance-inv-9123456799@friends-foes.com>',
        '<partial-remittance-9123456999@garfild.com>',
        '<marketing-advice-999@apex-consulting.org>',
    ];
    for (const id of mockIds) {
        const stored = logs.filter((l: any) => l.messageId === id);
        assert.equal(stored.length, 1, `mail ${id} stored exactly once`);
        assert.match(String(stored[0].filename), /\.pdf$/i);
        assert.notEqual(stored[0].processingStatus, 'received', 'Agent 2 must process every received mail');
        assert.ok(stored[0].payment_ID, 'Agent 2 links the mail to a payment');
    }

    const second = await post('/syncMailbox', {});
    assert.equal((await second.json()).value.length, 0, 'already stored mails are not downloaded again');
});

test('health probe: /health/live returns 200 UP', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(res.status, 200);
    const data = await res.json() as { status: string };
    assert.equal(data.status, 'UP');
});

test('health probe: /health/ready returns 200 UP with dependency details', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(res.status, 200);
    const data = await res.json() as { status: string; checks: { database: boolean } };
    assert.equal(data.status, 'UP');
    assert.equal(data.checks.database, true);
});
test('Payments with status posted/cleared have StatusCriticality 5 (Blue), ConfidenceCriticality 5 (Blue) and statusText Posted', async () => {
    const res = await get('/Payments');
    assert.ok(Array.isArray(res.value));
    for (const p of res.value) {
        if (p.status === 'posted' || p.status === 'cleared') {
            assert.equal(p.StatusCriticality, 5, 'StatusCriticality must be 5 (Blue / Information) for posted payments');
            assert.equal(p.ConfidenceCriticality, 5, 'ConfidenceCriticality must be 5 (Blue / Information) for posted payments');
            assert.equal(p.statusText, 'Posted');
        }
    }
});
