using { poc.cash as my } from '../db/schema';

service CashSyncService {
    entity OpenItem as projection on my.OpenItem;

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
        // Akcja wykonywana dla zaznaczonego w tabeli wiersza
        action triggerAIAgent() returns String;
    };

    entity RemittanceItem as projection on my.RemittanceItem;
    entity AgentRun as projection on my.AgentRun;
    entity ManualTask as projection on my.ManualTask;

    action ingestAgentMatch(
        match_id: String,
        open_item_id: String,
        bank_line_id: String,
        remittance_item_id: String,
        run_id: String,
        matched_amount: Decimal(15,2),
        confidence: Decimal(5,2)
    ) returns String;
}
