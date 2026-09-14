import cds from '@sap/cds';

export default async function () {
    const { MatchResult } = this.entities;
    const { 'poc.cash.MatchResult': DbMatchResult } = cds.entities('poc.cash');

    const remoteService = await cds.connect.to('ZAC_OPENITEMS_MOC_O4');

    // Przekierowanie zapytania READ do encji SAP
    this.on('READ', 'OpenItem', async (req) => {
        try {
            const query = SELECT.from('zac_openitems_moc');
            
            if (req.query.SELECT?.where) {
                query.where(req.query.SELECT.where);
            }
            if (req.query.SELECT?.limit) {
                query.limit(req.query.SELECT.limit.rows, req.query.SELECT.limit.offset);
            }

            return await remoteService.run(query);
        } catch (error) {
            console.error('Błąd remote OData, fallback na SQLite:', error.message);
            return await SELECT.from('poc.cash.OpenItem');
        }
    });

    this.on('triggerAIAgent', 'MatchResult', async (req) => {
        const matchId = req.params[0]?.match_id || req.params[0];

        await UPDATE(DbMatchResult)
            .set({ 
                match_status: 'MATCHED', 
                action_required: false,
                review_status: 'APPROVED'
            })
            .where({ match_id: matchId });

        req.notify(`Agent AI pomyślnie przetworzył rekord ${matchId}`);
    });
    

    this.on('ingestAgentMatch', async (req) => {
        const { match_id, open_item_id, matched_amount, confidence } = req.data;
        
        await INSERT.into(DbMatchResult).entries({
            match_id: match_id,
            open_item_OpenItemId: open_item_id,
            matched_amount: matched_amount,
            match_status: confidence > 0.8 ? 'MATCHED' : 'NEEDS_REVIEW',
            action_required: confidence <= 0.8
        });

        return "Match stored successfully";
    });
}
