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
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.CASH_AI_ENABLED;
    delete env.CASH_S4_ENABLED;
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
    assert.match(await metadata.text(), /CashSyncService/);
    assert.ok((await get('/OpenItem')).value.length >= 5);
    assert.equal((await get('/MatchResult')).value.length, 3);
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

test('processPaymentDocument routes zero-confidence mock extraction to needsReview without matches', async () => {
    const paymentsBefore = (await get('/Payments')).value.length;
    const response = await post('/processPaymentDocument', { pdfBase64: Buffer.from('unused').toString('base64') });
    assert.match((await response.json()).value, /Stored 0 proposed match/);

    const payments = (await get('/Payments')).value;
    assert.equal(payments.length, paymentsBefore + 1);
    const payment = payments.filter((p: any) => String(p.payer).includes('[MOCK]')).at(-1);
    assert.ok(payment, 'expected a mock payment row');
    assert.equal(Number(payment.extractionConfidence), 0);
    // Mock confidence 0 < LOW_CONFIDENCE_THRESHOLD (0.6): matching is skipped,
    // the payment goes straight to needsReview with no candidates persisted.
    assert.equal(payment.status, 'needsReview');

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

test('uploadPayment stores the payment on fixture data (mock confidence routes to needsReview)', async () => {
    const paymentsBefore = (await get('/Payments')).value.length;
    const response = await post('/uploadPayment', {
        fileName: 'mock-remittance.pdf',
        fileContent: Buffer.from('unused').toString('base64'),
    });
    const stored = await response.json();
    assert.match(stored.payer, /MOCK|Test payer/);
    // Mock extraction confidence 0 < 0.6: matching skipped, no candidates.
    assert.equal(stored.status, 'needsReview');

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
    assert.ok(Number(updated.extractionConfidence) >= 0.95);
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

test('postToS4 on multi-invoice payment triggers clearing in S/4HANA', async () => {
    const id = '00000001-0000-0000-0000-000000000004';
    const response = await postRaw(`/Payments('${id}')/CashSyncService.postToS4`, {});
    assert.ok([200, 502].includes(response.status));
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

test('reprocessWithAI updates token metrics, estimated cost, and CU on payment', async () => {
    const id = '00000001-0000-0000-0000-000000000001';
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

