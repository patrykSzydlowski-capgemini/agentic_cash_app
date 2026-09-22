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
    const env: NodeJS.ProcessEnv = { ...process.env, CASH_AI_ENABLED: 'false', CASH_S4_ENABLED: 'false' };
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
    assert.equal((await get('/OpenItem')).value.length, 5);
    assert.equal((await get('/MatchResult')).value.length, 3);
});

test('triggerAIAgent updates the selected match and returns notification', async () => {
    const path = "/MatchResult('MATCH-002')";
    const response = await post(path + '/CashSyncService.triggerAIAgent', {});
    assert.match(response.headers.get('sap-messages') ?? '', /MATCH-002/);
    const match = await get(path);
    assert.equal(match.match_status, 'MATCHED');
    assert.equal(match.action_required, false);
    assert.equal(match.review_status, 'APPROVED');
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
});

test('uploadPayment rejects wrong-typed content at the OData layer (400)', async () => {
    // Edm.Binary validation fires before the handler: a JSON number never
    // reaches decodeFileContent, so the 400 comes from the OData layer.
    const response = await postRaw('/uploadPayment', { fileName: 'bad.pdf', fileContent: 42 });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /not a valid LargeBinary/);
});
