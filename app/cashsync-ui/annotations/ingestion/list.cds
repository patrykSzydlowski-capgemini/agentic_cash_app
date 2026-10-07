using CashSyncService as service from '../../../../srv/cat-service';

annotate service.IngestionLog with @(
    UI.SelectionFields : [
        source,
        processingStatus
    ],
    // LR tab "All mails"
    UI.LineItem : [
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.EntityContainer/syncMailbox',
            Label  : '{i18n>actionSyncMailbox}'
        },
        { $Type: 'UI.DataField', Value: timestamp,        Label: '{i18n>fieldTimestamp}',        ![@HTML5.CssDefaults]: {width: '12rem'} },
        { $Type: 'UI.DataField', Value: sender,           Label: '{i18n>fieldSender}',           ![@HTML5.CssDefaults]: {width: '14rem'} },
        { $Type: 'UI.DataField', Value: subject,          Label: '{i18n>fieldSubject}',          ![@HTML5.CssDefaults]: {width: '18rem'} },
        { $Type: 'UI.DataField', Value: filename,         Label: '{i18n>fieldFilename}',         ![@HTML5.CssDefaults]: {width: '16rem'} },
        { $Type: 'UI.DataField', Value: processingStatus, Criticality: ProcessingCriticality, Label: '{i18n>fieldProcessingStatus}', ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: payment.payer,    Label: '{i18n>fieldPayer}',            ![@HTML5.CssDefaults]: {width: '14rem'} },
        { $Type: 'UI.DataField', Value: payment.amount,   Label: '{i18n>fieldAmount}',           ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: classificationReason, Label: '{i18n>fieldClassificationReason}', ![@HTML5.CssDefaults]: {width: '24rem'} },
        { $Type: 'UI.DataField', Value: messageId,        Label: '{i18n>fieldMessageId}',        ![@HTML5.CssDefaults]: {width: '16rem'} }
    ],
    // Rendered inside Payments Object Page 'Ingestion Log' tab
    UI.LineItem #ingestion : [
        { $Type: 'UI.DataField', Value: timestamp,              Label: '{i18n>fieldTimestamp}',              ![@HTML5.CssDefaults]: {width: '12rem'} },
        { $Type: 'UI.DataField', Value: source,                 Label: '{i18n>fieldSource}',                 ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: subject,                Label: '{i18n>fieldSubject}',                ![@HTML5.CssDefaults]: {width: '18rem'} },
        { $Type: 'UI.DataField', Value: filename,               Label: '{i18n>fieldFilename}',               ![@HTML5.CssDefaults]: {width: '16rem'} },
        { $Type: 'UI.DataField', Value: classificationDecision, Criticality: DecisionCriticality, Label: '{i18n>fieldClassificationDecision}', ![@HTML5.CssDefaults]: {width: '14rem'} },
        { $Type: 'UI.DataField', Value: classificationReason,   Label: '{i18n>fieldClassificationReason}',   ![@HTML5.CssDefaults]: {width: '24rem'} },
        { $Type: 'UI.DataField', Value: messageId,              Label: '{i18n>fieldMessageId}',              ![@HTML5.CssDefaults]: {width: '16rem'} }
    ]
);
