using { poc.cash as my } from '../db/schema';
using { ZAC_OPENITEMS_MOC_O4 as external } from './external/ZAC_OPENITEMS_MOC_O4';

service CashSyncService {

    @cds.mapped.from: 'zac_openitems_moc'
    entity OpenItem as projection on external.zac_openitems_moc;

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
