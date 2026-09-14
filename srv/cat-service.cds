using { poc.cash as my } from '../db/schema';
using { ZAC_OPENITEMS_MOC_O4 as external } from './external/ZAC_OPENITEMS_MOC_O4';

service CashSyncService {

    @cds.mapped.from: 'zac_openitems_moc'
    entity OpenItem as projection on external.zac_openitems_moc;

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

// Osobny bloki adnotacji, aby nie zaburzać struktury CDS
annotate CashSyncService.OpenItem with @(
    UI.LineItem : [
        { Value: OpenItemId,      Label: 'ID Pozycji' },
        { Value: CustomerAccount, Label: 'Konto Klienta' },
        { Value: CustomerName,    Label: 'Nazwa Klienta' },
        { Value: InvoiceAmount,   Label: 'Kwota' }
    ]
);
