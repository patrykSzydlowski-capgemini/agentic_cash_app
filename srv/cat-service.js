import cds from '@sap/cds';

export default async function () {
    const { OpenItem, MatchResult } = this.entities;

    // Obsługa pobierania OpenItem z lokalnej bazy danych SQLite
    this.on('READ', 'OpenItem', async (req) => {
        return await SELECT.from(OpenItem).where(req.query.SELECT.where || {});
    });

    // Obsługa kliknięcia przycisku "Agenta AI" z poziomu UI Fiori
    this.on('triggerAIAgent', 'MatchResult', async (req) => {
        const [matchId] = req.params; // Pobranie ID zaznaczonego wiersza


        await UPDATE(MatchResult)
            .set({ 
                match_status: 'MATCHED', 
                action_required: false,
                review_status: 'APPROVED'
            })
            .where({ match_id: matchId });


        req.notify(`Agent AI pomyślnie przetworzył rekord ${matchId}`);
    });

    // Ingestowanie dopasowań wygenerowanych przez agenta AI (API)
    this.on('ingestAgentMatch', async (req) => {
        const { match_id, open_item_id, matched_amount, confidence } = req.data;
        
        await INSERT.into(MatchResult).entries({
            match_id: match_id,
            open_item_OpenItemId: open_item_id,
            matched_amount: matched_amount,
            match_status: confidence > 0.8 ? 'MATCHED' : 'NEEDS_REVIEW',
            action_required: confidence <= 0.8
        });

        return "Match stored successfully";
    });
}
