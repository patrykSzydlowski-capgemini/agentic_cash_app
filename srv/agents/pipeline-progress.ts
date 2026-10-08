// Live progress of one pipeline run, kept in memory and polled by the UI
// ("Revalidate Items" dialog via getPipelineProgress). The percentage is a
// weighted estimate: every phase of the run gets a share by its typical cost,
// and the current phase advances with processed / total.

export const PIPELINE_PHASE = Object.freeze({
    ERP_SYNC: 'erpSync',
    MAIL_INTAKE: 'mailIntake',
    EXTRACTION: 'extraction',
    MATCHING: 'matching',
    ASSESSMENT: 'assessment',
    DONE: 'done',
} as const)

export type PipelinePhase = typeof PIPELINE_PHASE[keyof typeof PIPELINE_PHASE]
export type WorkPhase = Exclude<PipelinePhase, 'done'>

export const PIPELINE_SCOPE = Object.freeze({
    ALL: 'all',
    OPEN_ITEMS: 'openItems',
    PAYMENTS: 'payments',
} as const)

export type PipelineScopeKind = typeof PIPELINE_SCOPE[keyof typeof PIPELINE_SCOPE]

export const PROGRESS_STATUS = Object.freeze({
    IDLE: 'idle',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
} as const)

export type ProgressStatus = typeof PROGRESS_STATUS[keyof typeof PROGRESS_STATUS]

// Relative cost of each phase; AI-bound phases dominate a run.
const PHASE_WEIGHT: Record<WorkPhase, number> = {
    erpSync: 1,
    mailIntake: 1,
    extraction: 3,
    matching: 4,
    assessment: 1,
}

export interface PipelineResultCounts {
    openItems: number
    extracted: number
    failed: number
    evaluated: number
    matched: number
    review: number
}

export interface PipelineProgressSnapshot extends PipelineResultCounts {
    runId: string | null
    trigger: string | null
    scope: PipelineScopeKind
    selectedCount: number
    status: ProgressStatus
    phase: PipelinePhase | null
    phaseIndex: number
    phaseCount: number
    processed: number
    total: number
    percent: number
    startedAt: string | null
    finishedAt: string | null
    message: string | null
}

const emptyCounts = (): PipelineResultCounts => ({ openItems: 0, extracted: 0, failed: 0, evaluated: 0, matched: 0, review: 0 })

export const idleProgressSnapshot = (): PipelineProgressSnapshot => ({
    runId: null,
    trigger: null,
    scope: PIPELINE_SCOPE.ALL,
    selectedCount: 0,
    status: PROGRESS_STATUS.IDLE,
    phase: null,
    phaseIndex: 0,
    phaseCount: 0,
    processed: 0,
    total: 0,
    percent: 0,
    startedAt: null,
    finishedAt: null,
    message: null,
    ...emptyCounts(),
})

export class PipelineProgress {
    private phase: PipelinePhase | null = null
    private processed = 0
    private total = 0
    private status: ProgressStatus = PROGRESS_STATUS.RUNNING
    private readonly startedAt = new Date().toISOString()
    private finishedAt: string | null = null
    private message: string | null = null
    private counts = emptyCounts()
    private percentAtFailure = 0

    constructor(
        readonly runId: string,
        readonly trigger: string,
        readonly phases: readonly WorkPhase[],
        readonly scope: PipelineScopeKind = PIPELINE_SCOPE.ALL,
        readonly selectedCount = 0,
    ) {}

    /** Enters a phase; `total` = units of work (0 when unknown, e.g. a remote call). */
    startPhase(phase: WorkPhase, total = 0): void {
        this.phase = phase
        this.processed = 0
        this.total = Math.max(0, total)
    }

    setTotal(total: number): void {
        this.total = Math.max(0, total)
    }

    advance(units = 1): void {
        this.processed = Math.min(this.total, this.processed + units)
    }

    complete(counts: PipelineResultCounts, message: string | null = null): void {
        this.counts = { ...counts }
        this.status = PROGRESS_STATUS.COMPLETED
        this.finish(message)
    }

    fail(message: string): void {
        // A failed run keeps the value it reached instead of jumping.
        this.percentAtFailure = this.runningPercent()
        this.status = PROGRESS_STATUS.FAILED
        this.finish(message)
    }

    get running(): boolean {
        return this.status === PROGRESS_STATUS.RUNNING
    }

    private finish(message: string | null): void {
        this.phase = PIPELINE_PHASE.DONE
        this.message = message
        this.finishedAt = new Date().toISOString()
    }

    /** 0–100; stays below 100 until the run has really completed. */
    percent(): number {
        if (this.status === PROGRESS_STATUS.COMPLETED) return 100
        if (this.status === PROGRESS_STATUS.FAILED) return this.percentAtFailure
        return this.runningPercent()
    }

    private runningPercent(): number {
        const totalWeight = this.phases.reduce((sum, phase) => sum + PHASE_WEIGHT[phase], 0)
        const index = this.phase ? this.phases.indexOf(this.phase as WorkPhase) : -1
        if (totalWeight === 0 || index < 0) return 0
        const done = this.phases.slice(0, index).reduce((sum, phase) => sum + PHASE_WEIGHT[phase], 0)
        const current = this.total > 0 ? PHASE_WEIGHT[this.phases[index]] * (this.processed / this.total) : 0
        return Math.min(99, Math.floor(((done + current) / totalWeight) * 100))
    }

    snapshot(): PipelineProgressSnapshot {
        const index = this.phase && this.phase !== PIPELINE_PHASE.DONE ? this.phases.indexOf(this.phase) : -1
        return {
            runId: this.runId,
            trigger: this.trigger,
            scope: this.scope,
            selectedCount: this.selectedCount,
            status: this.status,
            phase: this.phase,
            phaseIndex: index >= 0 ? index + 1 : this.phase === PIPELINE_PHASE.DONE ? this.phases.length : 0,
            phaseCount: this.phases.length,
            processed: this.processed,
            total: this.total,
            percent: this.percent(),
            startedAt: this.startedAt,
            finishedAt: this.finishedAt,
            message: this.message,
            ...this.counts,
        }
    }
}
