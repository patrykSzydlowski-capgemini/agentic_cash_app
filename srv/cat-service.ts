import cds from '@sap/cds'
import type { Request } from '@sap/cds'
import type { ingestAgentMatch } from '../@cds-models/CashSyncService/index.js'

const { INSERT, UPDATE } = cds.ql

// Local-first: OpenItem is served from SQLite (poc.cash.OpenItem).
// Remote SAP mock (ZAC_OPENITEMS_MOC_O4) kept in srv/external/ for reference only.
// NOTE: package.json no longer requires the remote destination, so no connect here.

/** Payload generated from the unbound CDS action. */
type IngestAgentMatchPayload = Parameters<typeof ingestAgentMatch>[0]

export default class CashSyncServiceImpl extends cds.ApplicationService {
    async init() {
        const { MatchResult: DbMatchResult } = cds.entities('poc.cash')

        this.on('triggerAIAgent', 'MatchResult', async (req: Request) => {
            const first = req.params[0] as { match_id?: string } | string | undefined
            const matchId = typeof first === 'object' ? (first?.match_id ?? first) : first

            await UPDATE.entity(DbMatchResult)
                .set({
                    match_status: 'MATCHED',
                    action_required: false,
                    review_status: 'APPROVED',
                })
                .where({ match_id: matchId })

            req.notify(`Agent AI pomyślnie przetworzył rekord ${matchId}`)
        })

        this.on('ingestAgentMatch', async (req: Request) => {
            const { match_id, open_item_id, matched_amount, confidence } = req.data as IngestAgentMatchPayload

            await INSERT.into(DbMatchResult).entries({
                match_id,
                open_item_OpenItemId: open_item_id,
                matched_amount,
                match_status: Number(confidence) > 0.8 ? 'MATCHED' : 'NEEDS_REVIEW',
                action_required: Number(confidence) <= 0.8,
            })

            return 'Match stored successfully'
        })

        return super.init()
    }
}
