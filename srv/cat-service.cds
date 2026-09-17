using { poc.cash as my } from '../db/schema';
// Remote SAP mock (srv/external/ZAC_OPENITEMS_MOC_O4) kept for reference only.
// Local-first: SQLite poc.cash.OpenItem is the source of truth.

service CashSyncService {

    entity OpenItem as projection on my.OpenItem;

    @cds.odata.expand: [ 'open_item' ]
    entity MatchResult as projection on my.MatchResult {
        *,
        open_item,
        case match_status
            when 'MATCHED'      then 3
            when 'NEEDS_REVIEW' then 2
            when 'REJECTED'     then 1
            else 0
        end as CriticalityCode : Integer
    } actions {
        action triggerAIAgent() returns String;
    };

    entity RemittanceItem as projection on my.RemittanceItem;
    entity AgentRun       as projection on my.AgentRun;
    entity ManualTask     as projection on my.ManualTask;

    // Akcja wywołująca Gemini 1.5 Flash do analizy pozycji
    action analyzeWithGemini() returns String;

    action ingestAgentMatch(
        match_id: String,
        open_item_id: String,
        matched_amount: Decimal(15,2),
        confidence: Decimal(5,2),
        review_reason: String
    ) returns String;
}
