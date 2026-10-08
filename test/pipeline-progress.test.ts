import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PIPELINE_PHASE, PipelineProgress, idleProgressSnapshot } from '../srv/agents/pipeline-progress.js';

const counts = { openItems: 7, extracted: 2, failed: 1, evaluated: 4, matched: 3, review: 1 };

test('pipeline progress: weighted percentage grows with phases and processed units, 100 only when completed', () => {
    const progress = new PipelineProgress('run-1', 'revalidation', [
        PIPELINE_PHASE.ERP_SYNC, PIPELINE_PHASE.MAIL_INTAKE, PIPELINE_PHASE.EXTRACTION, PIPELINE_PHASE.MATCHING, PIPELINE_PHASE.ASSESSMENT,
    ]);
    assert.equal(progress.snapshot().percent, 0);
    assert.equal(progress.snapshot().status, 'running');

    progress.startPhase(PIPELINE_PHASE.ERP_SYNC);
    assert.equal(progress.snapshot().percent, 0);
    assert.equal(progress.snapshot().phaseIndex, 1);

    progress.startPhase(PIPELINE_PHASE.EXTRACTION, 4);
    const extractionStart = progress.snapshot().percent;
    assert.equal(extractionStart, 20, 'weights 1+1 of 10 are done');
    progress.advance();
    progress.advance();
    assert.equal(progress.snapshot().percent, 35);
    assert.equal(progress.snapshot().processed, 2);
    assert.equal(progress.snapshot().total, 4);

    progress.startPhase(PIPELINE_PHASE.MATCHING, 2);
    progress.advance(5);
    assert.equal(progress.snapshot().processed, 2, 'processed never exceeds total');
    assert.equal(progress.snapshot().percent, 90);

    progress.startPhase(PIPELINE_PHASE.ASSESSMENT);
    assert.ok(progress.snapshot().percent < 100, 'a running run never shows 100 %');

    progress.complete(counts);
    const done = progress.snapshot();
    assert.equal(done.status, 'completed');
    assert.equal(done.phase, 'done');
    assert.equal(done.phaseIndex, 5);
    assert.equal(done.percent, 100);
    assert.equal(done.evaluated, 4);
    assert.ok(done.finishedAt);
});

test('pipeline progress: a failed run keeps the reached percentage and the error message', () => {
    const progress = new PipelineProgress('run-2', 'revalidation', [PIPELINE_PHASE.ERP_SYNC, PIPELINE_PHASE.MATCHING], 'payments', 3);
    progress.startPhase(PIPELINE_PHASE.MATCHING, 2);
    progress.advance();
    const before = progress.snapshot().percent;
    progress.fail('AI provider down');
    const failed = progress.snapshot();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.percent, before);
    assert.equal(failed.message, 'AI provider down');
    assert.equal(failed.scope, 'payments');
    assert.equal(failed.selectedCount, 3);
});

test('pipeline progress: idle snapshot before the first run', () => {
    const idle = idleProgressSnapshot();
    assert.equal(idle.status, 'idle');
    assert.equal(idle.runId, null);
    assert.equal(idle.percent, 0);
});
