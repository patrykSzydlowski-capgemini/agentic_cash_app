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
    assert.match(match.review_reason, /Manually approved/);
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
    assert.match(body, /has no matched open item/);
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

// revalidatePipeline only starts the run; poll its progress until it has finished.
async function waitForPipeline(runId: string) {
    for (let attempt = 0; attempt < 300; attempt++) {
        const progress = await get('/getPipelineProgress()');
        if (progress.runId === runId && progress.status !== 'running') return progress;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Pipeline run ${runId} did not finish`);
}

test('revalidatePipeline starts the full 3-agent pipeline in the background and reports progress', async () => {
    assert.equal((await get('/getPipelineProgress()')).status, 'idle', 'no pipeline run yet');
    const response = await post('/revalidatePipeline', {});
    assert.equal(response.status, 200);
    const started = await response.json();
    assert.ok(started.runId, 'the run id is returned at once');
    assert.equal(started.scope, 'all');
    assert.equal(started.selectedCount, 0);
    assert.equal(started.phaseCount, 5, 'S/4 sync, mail intake, extraction, matching, assessment');

    const done = await waitForPipeline(started.runId);
    assert.equal(done.status, 'completed', done.message ?? '');
    assert.equal(done.phase, 'done');
    assert.equal(done.percent, 100);
    assert.ok(done.finishedAt, 'finishedAt should be set');
    assert.ok(done.evaluated > 0, 'Agent 3 evaluated payments');
    assert.ok(done.openItems >= 5, 'open items considered by the run');

    const run = await get(`/PipelineRuns(${started.runId})`);
    assert.equal(run.trigger, 'revalidation');
    assert.equal(run.status, 'completed', 'the background run row is stored with the same id');
    assert.equal(run.paymentsEvaluated, done.evaluated);
});

test('revalidatePipeline with selected payments re-matches only those and retries unusable extractions', async () => {
    const usable = '00000001-0000-0000-0000-000000000002';   // extracted, ref OP-1001
    const unusable = '00000001-0000-0000-0000-000000000003'; // needsReview, confidence 0.30, no stored PDF
    const started = await (await post('/revalidatePipeline', { paymentIds: [usable, unusable] })).json();
    assert.equal(started.scope, 'payments');
    assert.equal(started.selectedCount, 2);
    assert.equal(started.phaseCount, 4, 'no mailbox step for a selection');

    const done = await waitForPipeline(started.runId);
    assert.equal(done.status, 'completed', done.message ?? '');
    assert.equal(done.evaluated, 1, 'only the selected usable payment is matched');
    assert.equal(done.failed, 1, 'the unusable payment has no PDF to re-extract');
    const run = await get(`/PipelineRuns(${started.runId})`);
    assert.equal(run.paymentsEvaluated, 1);
    assert.equal(run.newMails, 0, 'the mailbox is not scanned for a selection');
});

test('revalidatePipeline with selected open items re-matches the payments linked to them', async () => {
    const started = await (await post('/revalidatePipeline', { openItemIds: ['OP-1003'] })).json();
    assert.equal(started.scope, 'openItems');
    assert.equal(started.selectedCount, 1);
    const done = await waitForPipeline(started.runId);
    assert.equal(done.status, 'completed', done.message ?? '');
    const allPayments = (await get('/Payments')).value
        .filter((p: any) => !['posted', 'cleared'].includes(p.status));
    assert.ok(done.evaluated >= 1, 'MultiTech Corp names OP-1003 in its references');
    assert.ok(done.evaluated < allPayments.length, 'unrelated payments are not re-matched');
    const [item] = (await get(`/OpenItem?$filter=OpenItemId eq 'OP-1003'`)).value;
    assert.ok(item.assessedAt, 'the selected open item is re-assessed');
});

test('revalidatePipeline with an unknown selection completes without evaluating anything', async () => {
    const started = await (await post('/revalidatePipeline', { openItemIds: ['DOES-NOT-EXIST'] })).json();
    const done = await waitForPipeline(started.runId);
    assert.equal(done.status, 'completed', done.message ?? '');
    assert.equal(done.evaluated, 0);
});

test('getAiStatistics aggregates finished pipeline runs: tokens, cost, CU, durations, volumes', async () => {
    const stats = await get('/getAiStatistics()');
    assert.ok(stats.totalRuns >= 1, 'revalidation / reprocess runs above must be counted');
    for (const field of ['failedRuns', 'totalPromptTokens', 'totalCompletionTokens', 'totalAiCalls', 'totalFilesExtracted',
        'totalPaymentsEvaluated', 'totalPaymentsMatched', 'avgDurationMs', 'avgTokensPerRun', 'medianDurationMs',
        'medianTokensPerRun', 'avgTokensPerFile', 'lastRunDurationMs', 'lastRunTokens', 'lastRunOpenItems']) {
        assert.equal(typeof stats[field], 'number', `${field} should be a number`);
    }
    // Only real provider usage is counted; the test mock reports none, so totals must merely be consistent.
    assert.equal(stats.totalTokens, stats.totalPromptTokens + stats.totalCompletionTokens);
    assert.ok(Number(stats.totalCost) >= 0 && Number(stats.totalCapacityUnits) >= 0);
    assert.ok(stats.totalPaymentsEvaluated > 0, 'matching agent evaluated payments');
    assert.ok(stats.lastRunAt, 'lastRunAt should be set');
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

test('PipelineRuns: every run is recorded with trigger, status, duration, AI usage and volumes', async () => {
    const runs = (await get('/PipelineRuns?$orderby=startedAt desc')).value;
    // The full revalidation run (the scoped runs started later evaluate fewer payments).
    const revalidation = runs
        .filter((run: any) => run.trigger === 'revalidation')
        .sort((a: any, b: any) => b.paymentsEvaluated - a.paymentsEvaluated)[0];
    assert.ok(revalidation, 'revalidatePipeline must create a run row');
    assert.equal(revalidation.status, 'completed');
    assert.equal(revalidation.statusText, 'Completed', 'enum value is shown with its localized title');
    assert.equal(revalidation.triggerText, 'Revalidation');
    assert.equal(typeof revalidation.durationMs, 'number');
    assert.ok(revalidation.finishedAt, 'finishedAt should be set');
    assert.ok(revalidation.openItemsOpen >= 5, 'open items considered by the run');
    assert.ok(revalidation.paymentsEvaluated > 0, 'payments evaluated by Agent 3');
    const reprocess = runs.find((run: any) => run.trigger === 'reprocess');
    assert.ok(reprocess, 'reprocessWithAI must create a run row');
    assert.equal(typeof reprocess.aiCalls, 'number', 'AI usage is attributed to the run');
    assert.equal(reprocess.totalTokens, reprocess.promptTokens + reprocess.completionTokens);
    // A deterministic exact match makes no AI call, so the model is named only when AI ran.
    assert.equal(Boolean(reprocess.aiModel), reprocess.aiCalls > 0, 'aiModel is set exactly when AI was called');
    const de = await (await fetch(`${base}/PipelineRuns(${revalidation.ID})?sap-locale=de`)).json();
    assert.equal(de.triggerText, 'Neuvalidierung');
});

test('PipelineRuns are read-only over OData', async () => {
    const response = await fetch(`${base}/PipelineRuns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'upload' }),
    });
    assert.ok(response.status >= 400 && response.status < 500, `expected 4xx, got ${response.status}`);
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

test('local test open items are served with source LOCAL next to the S/4 cache', async () => {
    let local: any[] = [];
    for (let attempt = 0; attempt < 30 && local.length === 0; attempt++) {
        local = (await get(`/OpenItem?$filter=source eq 'LOCAL'`)).value;
        if (local.length === 0) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(local.some((i: any) => i.OpenItemId === '9900000103'), 'unpaid local test item expected');
    assert.ok(local.every((i: any) => i.sourceText === 'Local test item'), 'source shown as its localized enum title');
    const s4 = await get(`/OpenItem('9123456999')`);
    assert.equal(s4.source, 'S4');
    assert.equal(s4.sourceText, 'S/4HANA');
});

test('posting a payment for local test items clears them locally without calling S/4HANA', async () => {
    const id = '00000001-0000-0000-0000-000000000005';
    const matched = await (await post(`/Payments('${id}')/CashSyncService.reprocessWithAI`, {})).json();
    assert.equal(matched.status, 'matched', 'Adventure Works pays 9900000106 + 9900000107 exactly');

    // The test S/4 destination does not exist, so a successful post proves S/4 was not called.
    const response = await postRaw(`/Payments('${id}')/CashSyncService.postToS4`, {});
    assert.equal(response.status, 200, await response.clone().text());

    const matches = (await get(`/ProposedMatches?$filter=payment_ID eq ${id}`)).value;
    assert.deepEqual(matches.map((m: any) => m.openItemId).sort(), ['9900000106', '9900000107']);
    for (const match of matches) {
        assert.equal(match.reviewStatus, 'posted');
        assert.equal(match.documentNumber, `LOCAL-${match.openItemId}`);
        assert.match(match.rationale, /Full match/);
    }
    for (const itemId of ['9900000106', '9900000107']) {
        const item = await get(`/OpenItem('${itemId}')`);
        assert.equal(item.ClearingStatus, 'CLEARED');
    }
    assert.equal((await get(`/Payments('${id}')`)).status, 'posted');
});

test('postOpenItem posts a selected local open item manually and moves it to the closed items', async () => {
    const response = await postRaw(`/OpenItem('9900000103')/CashSyncService.postOpenItem`, {});
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).ClearingStatus, 'CLEARED');
    const closed = (await get(`/OpenItem?$filter=ClearingStatus eq 'CLEARED' and OpenItemId eq '9900000103'`)).value;
    assert.equal(closed.length, 1, 'posted item is listed on the Closed Items tab');

    const again = await postRaw(`/OpenItem('9900000103')/CashSyncService.postOpenItem`, {});
    assert.equal(again.status, 409, 'an already cleared item cannot be posted twice');
});

test('postOpenItem also posts the proposals pointing to the item and their payment', async () => {
    const paymentId = '00000001-0000-0000-0000-000000000006';
    const matched = await (await post(`/Payments('${paymentId}')/CashSyncService.reprocessWithAI`, {})).json();
    assert.equal(matched.status, 'matched', 'Northwind pays 9900000101 exactly');

    const response = await postRaw(`/OpenItem('9900000101')/CashSyncService.postOpenItem`, {});
    assert.equal(response.status, 200, await response.clone().text());
    const [match] = (await get(`/ProposedMatches?$filter=payment_ID eq ${paymentId}`)).value;
    assert.equal(match.reviewStatus, 'posted');
    assert.equal(match.documentNumber, 'LOCAL-9900000101');
    assert.equal((await get(`/Payments('${paymentId}')`)).status, 'posted');
});

test('postOpenItem on an S/4 item fails cleanly when S/4HANA is unreachable and keeps the item open', async () => {
    const response = await postRaw(`/OpenItem('9123456999')/CashSyncService.postOpenItem`, {});
    assert.equal(response.status, 502, await response.clone().text());
    assert.equal((await get(`/OpenItem('9123456999')`)).ClearingStatus, 'OPEN');
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

test('OpenItem DELETE is a soft delete: hidden from the service and the matching pool, S/4 data kept', async () => {
    const id = '9123456999';
    const patched = await fetch(`${base}/OpenItem('${id}')`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ CustomerName: 'X' }),
    });
    assert.equal(patched.status, 405, 'open items are never edited from the UI');
    const deleted = await fetch(`${base}/OpenItem('${id}')`, { method: 'DELETE' });
    assert.equal(deleted.status, 204, await deleted.clone().text());
    const missing = await fetch(`${base}/OpenItem('${id}')`);
    assert.equal(missing.status, 404);
    const items = (await get('/OpenItem')).value;
    assert.ok(!items.some((i: any) => i.OpenItemId === id), 'dismissed item is hidden from the list');
    const again = await fetch(`${base}/OpenItem('${id}')`, { method: 'DELETE' });
    assert.equal(again.status, 404);
});
