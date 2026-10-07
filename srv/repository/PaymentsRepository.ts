import cds from '@sap/cds'
import { INGESTION_PROCESSING_STATUS, OPEN_ITEM_CLEARING_STATUS, OPEN_ITEM_SOURCE, PIPELINE_RUN_STATUS, PROPOSED_MATCH_STATUS } from '#constants'

/**
 * Enterprise Repository Pattern (inspired by DHL template):
 * Encapsulates all database reads, writes, updates and deletions for Payments,
 * ProposedMatches, OpenItems, and MatchResults.
 */
export class PaymentsRepository {
    private get payments() {
        return cds.entities('poc.cashapp').Payments
    }

    private get proposedMatches() {
        return cds.entities('poc.cashapp').ProposedMatches
    }

    private get openItems() {
        return cds.entities('poc.cash').OpenItem
    }

    private get matchResults() {
        return cds.entities('poc.cash').MatchResult
    }

    private get ingestionLog() {
        return cds.entities('poc.cashapp').IngestionLog
    }

    private get pipelineRuns() {
        return cds.entities('poc.cashapp').PipelineRuns
    }

    /** Items the user has not deleted (soft delete flag `dismissed`). */
    private activeOpenItems() {
        return SELECT.from(this.openItems).where('dismissed is null or dismissed = false')
    }

    async findPaymentById(id: string) {
        return SELECT.one.from(this.payments).where({ ID: id })
    }

    async findAllPayments(columns?: string[]) {
        const query = SELECT.from(this.payments)
        if (columns && columns.length > 0) {
            query.columns(...columns)
        }
        return query
    }

    async insertPayment(payment: Record<string, unknown>) {
        return INSERT.into(this.payments).entries(payment)
    }

    async updatePayment(id: string, changes: Record<string, unknown>) {
        return UPDATE.entity(this.payments, id).with(changes)
    }

    async findMatchesByPaymentId(paymentId: string) {
        return SELECT.from(this.proposedMatches).where({ payment_ID: paymentId })
    }

    async findUnpostedMatchesByPaymentId(paymentId: string) {
        return SELECT.from(this.proposedMatches)
            .where({ payment_ID: paymentId })
            .and({ reviewStatus: { '!=': 'posted' } })
    }

    async findOtherUnpostedMatches(paymentId: string, excludeMatchId: string) {
        return SELECT.from(this.proposedMatches)
            .where({ payment_ID: paymentId })
            .and({ ID: { '!=': excludeMatchId } })
            .and({ reviewStatus: { '!=': 'posted' } })
    }

    /** Proposals still waiting for a posting decision (not posted, not rejected) on one open item. */
    async findUnpostedMatchesForOpenItem(openItemId: string) {
        return SELECT.from(this.proposedMatches)
            .where({ openItemId })
            .and({ reviewStatus: { 'not in': [PROPOSED_MATCH_STATUS.POSTED, PROPOSED_MATCH_STATUS.REJECTED] } })
    }

    async markMatchesPosted(matchIds: string[], posting: { postingId: string; documentNumber: string }) {
        if (!matchIds || matchIds.length === 0) return 0
        return UPDATE(this.proposedMatches)
            .set({ reviewStatus: PROPOSED_MATCH_STATUS.POSTED, ...posting, postingError: null })
            .where({ ID: { in: matchIds } })
    }

    async insertProposedMatches(matches: Array<Record<string, unknown>>) {
        if (!matches || matches.length === 0) return []
        return INSERT.into(this.proposedMatches).entries(matches)
    }

    async updateProposedMatch(id: string, changes: Record<string, unknown>) {
        return UPDATE.entity(this.proposedMatches, id).with(changes)
    }

    async deleteProposedMatchesByPaymentId(paymentId: string) {
        return DELETE.from(this.proposedMatches).where({ payment_ID: paymentId })
    }

    async findAllCachedOpenItems() {
        return this.activeOpenItems()
    }

    async insertCachedOpenItems(items: Array<Record<string, unknown>>) {
        if (!items || items.length === 0) return []
        return INSERT.into(this.openItems).entries(items)
    }

    /** PATCH-style sync (capire UPSERT): only S/4 fields are written, AI assessment columns survive. */
    async upsertOpenItems(items: Array<Record<string, unknown>>) {
        if (!items || items.length === 0) return
        return UPSERT.into(this.openItems).entries(items)
    }

    /** Drops cached items S/4HANA no longer returns (archived / reversed documents); local test items stay. */
    async deleteOpenItemsNotIn(openItemIds: string[]) {
        // `source` is null on rows cached before the column existed — those are S/4 rows.
        const notLocal = `source is null or source != '${OPEN_ITEM_SOURCE.LOCAL}'`
        if (openItemIds.length === 0) return DELETE.from(this.openItems).where(notLocal)
        return DELETE.from(this.openItems).where({ OpenItemId: { 'not in': openItemIds } }).and(notLocal)
    }

    /**
     * Writes only rows whose id is not cached yet, so local test items keep
     * their state (cleared, dismissed, AI assessment) across restarts. UPSERT
     * keeps concurrent seeding idempotent; rows must carry every non-default field.
     */
    async insertMissingOpenItems(items: Array<Record<string, unknown>>): Promise<number> {
        if (!items || items.length === 0) return 0
        const ids = items.map(item => String(item.OpenItemId))
        const existing = await SELECT.from(this.openItems).columns('OpenItemId').where({ OpenItemId: { in: ids } }) as Array<{ OpenItemId: string }>
        const known = new Set(existing.map(row => row.OpenItemId))
        const missing = items.filter(item => !known.has(String(item.OpenItemId)))
        if (missing.length > 0) await UPSERT.into(this.openItems).entries(missing)
        return missing.length
    }

    /** Ids among `openItemIds` that are local test items (cleared locally, never posted to S/4HANA). */
    async findLocalOpenItemIds(openItemIds: string[]): Promise<Set<string>> {
        if (!openItemIds || openItemIds.length === 0) return new Set()
        const rows = await SELECT.from(this.openItems).columns('OpenItemId')
            .where({ OpenItemId: { in: openItemIds }, source: OPEN_ITEM_SOURCE.LOCAL }) as Array<{ OpenItemId: string }>
        return new Set(rows.map(row => row.OpenItemId))
    }

    async markOpenItemsCleared(openItemIds: string[]) {
        if (!openItemIds || openItemIds.length === 0) return
        return UPDATE(this.openItems)
            .set({ ClearingStatus: OPEN_ITEM_CLEARING_STATUS.CLEARED })
            .where({ OpenItemId: { in: openItemIds } })
    }

    async findOpenItemsByStatus(status: string) {
        return this.activeOpenItems().and({ ClearingStatus: status })
    }

    /**
     * Soft delete from the UI: S/4HANA stays the source of truth, so the row is
     * kept (the next UPSERT sync would re-create it) but hidden everywhere.
     * Pending AI proposals for these items are dropped; human decisions stay.
     */
    async dismissOpenItems(openItemIds: string[]) {
        if (!openItemIds || openItemIds.length === 0) return 0
        await DELETE.from(this.proposedMatches)
            .where({ openItemId: { in: openItemIds }, reviewStatus: PROPOSED_MATCH_STATUS.PENDING })
        return UPDATE(this.openItems).set({ dismissed: true })
            .where({ OpenItemId: { in: openItemIds } })
            .and('dismissed is null or dismissed = false')
    }

    async updateOpenItemAssessment(openItemId: string, assessment: Record<string, unknown>) {
        return UPDATE.entity(this.openItems, openItemId).with(assessment)
    }

    async findAllProposedMatches() {
        return SELECT.from(this.proposedMatches)
    }

    async findRejectedMatchesByPaymentId(paymentId: string) {
        return SELECT.from(this.proposedMatches)
            .where({ payment_ID: paymentId, reviewStatus: PROPOSED_MATCH_STATUS.REJECTED })
    }

    /**
     * Removes matches Agent 3 may recompute: pending proposals and legacy
     * placeholder rows without an open item. Approved (failed posting),
     * rejected and posted rows are human decisions and stay untouched.
     */
    async deleteReplaceableMatchesByPaymentId(paymentId: string) {
        await DELETE.from(this.proposedMatches).where({ payment_ID: paymentId, reviewStatus: PROPOSED_MATCH_STATUS.PENDING })
        await DELETE.from(this.proposedMatches).where({ payment_ID: paymentId, openItemId: null })
        await DELETE.from(this.proposedMatches).where({ payment_ID: paymentId, openItemId: '' })
    }

    async insertMatchResult(entry: Record<string, unknown>) {
        return INSERT.into(this.matchResults).entries(entry)
    }

    async hasLoggedMessage(messageId: string): Promise<boolean> {
        if (!messageId) return false
        const existing = await SELECT.one.from(this.ingestionLog).where({ messageId })
        return existing != null
    }

    async insertIngestionLog(entry: Record<string, unknown>) {
        return INSERT.into(this.ingestionLog).entries(entry)
    }

    async findIngestionLogsByPaymentId(paymentId: string) {
        return SELECT.from(this.ingestionLog).where({ payment_ID: paymentId }).orderBy('timestamp desc')
    }

    async findPendingIngestionLogs() {
        return SELECT.from(this.ingestionLog)
            .columns('*', 'attachmentContent')
            .where({ processingStatus: INGESTION_PROCESSING_STATUS.RECEIVED })
            .orderBy('timestamp asc')
    }

    async findFailedIngestionLogs() {
        return SELECT.from(this.ingestionLog)
            .columns('*', 'attachmentContent')
            .where({ processingStatus: INGESTION_PROCESSING_STATUS.FAILED })
            .orderBy('timestamp asc')
    }

    async updateIngestionLog(id: string, changes: Record<string, unknown>) {
        return UPDATE.entity(this.ingestionLog, id).with(changes)
    }

    async insertPipelineRun(entry: Record<string, unknown>) {
        return INSERT.into(this.pipelineRuns).entries(entry)
    }

    async updatePipelineRun(id: string, changes: Record<string, unknown>) {
        return UPDATE.entity(this.pipelineRuns, id).with(changes)
    }

    async findFinishedPipelineRuns() {
        return SELECT.from(this.pipelineRuns).where({ status: { '!=': PIPELINE_RUN_STATUS.RUNNING } }).orderBy('startedAt desc')
    }

    async findAllIngestionLogs(limit = 100) {
        return SELECT.from(this.ingestionLog).orderBy('timestamp desc').limit(limit)
    }
}

export const paymentsRepository = new PaymentsRepository()
