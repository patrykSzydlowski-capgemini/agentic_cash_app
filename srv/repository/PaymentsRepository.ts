import cds from '@sap/cds'

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
        return SELECT.from(this.openItems)
    }

    async insertCachedOpenItems(items: Array<Record<string, unknown>>) {
        if (!items || items.length === 0) return []
        return INSERT.into(this.openItems).entries(items)
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

    async findAllIngestionLogs(limit = 100) {
        return SELECT.from(this.ingestionLog).orderBy('timestamp desc').limit(limit)
    }
}

export const paymentsRepository = new PaymentsRepository()
