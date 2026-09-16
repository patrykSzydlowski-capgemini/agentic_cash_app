using CashSyncService as service from '../../srv/cat-service';

annotate service.MatchResult with @(
    UI.HeaderInfo : {
        TypeName       : 'Dopasowanie',
        TypeNamePlural : 'Dopasowania Płatności',
        Title          : { $Type: 'UI.DataField', Value: match_id }
    },
    UI.SelectionFields : [
        match_status,
        review_status,
        action_required
    ],
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: match_id,                Label: 'ID Dopasowania' },
        { $Type: 'UI.DataField', Value: open_item.OpenItemId,    Label: 'ID Pozycji SAP' },
        { $Type: 'UI.DataField', Value: open_item.CustomerName,  Label: 'Klient' },
        { $Type: 'UI.DataField', Value: matched_amount,          Label: 'Dopasowana Kwota' },
        { $Type: 'UI.DataField', Value: confidence,              Label: 'Pewność AI' },
        { $Type: 'UI.DataField', Value: match_status,            Criticality: CriticalityCode, Label: 'Status' },
        { $Type: 'UI.DataField', Value: review_reason,           Label: 'Analiza Gemini AI' },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.triggerAIAgent',
            Label  : 'Zatwierdź Ręcznie'
        }
    ]
);

annotate service.OpenItem with @(
    UI.LineItem : [
        { Value: OpenItemId,      Label: 'ID Pozycji' },
        { Value: CustomerAccount, Label: 'Konto Klienta' },
        { Value: CustomerName,    Label: 'Nazwa Klienta' },
        { Value: InvoiceAmount,   Label: 'Kwota' },
        { Value: ClearingStatus,  Label: 'Status' }
    ]
);
