using CashSyncService as service from '../../../../srv/cat-service';

annotate service.MatchResult with @(
    UI.SelectionFields : [
        match_status,
        review_status,
        action_required
    ],
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: match_id,                Label: '{i18n>matchTypeName}',             ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: open_item.OpenItemId,    Label: '{i18n>fieldOpenItemId}',           ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: open_item.CustomerName,  Label: '{i18n>fieldCustomerName}',         ![@HTML5.CssDefaults]: {width: '16rem'} },
        { $Type: 'UI.DataField', Value: matched_amount,          Label: '{i18n>fieldAmount}',               ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: confidence,              Label: '{i18n>fieldExtractionConfidence}', ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: match_status,            Criticality: CriticalityCode, Label: '{i18n>fieldStatus}', ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: review_reason,           Label: '{i18n>fieldRationale}',            ![@HTML5.CssDefaults]: {width: '22rem'} },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.triggerAIAgent',
            Label  : '{i18n>actionReprocessWithAI}'
        },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.manualApprove',
            Label  : '{i18n>actionManualApprove}'
        }
    ]
);
