using CashSyncService as service from '../../../../srv/cat-service';

annotate service.OpenItem with @(
    UI.LineItem : [
        { Value: OpenItemId,      Label: '{i18n>fieldOpenItemId}',      ![@HTML5.CssDefaults]: {width: '11rem'} },
        { Value: CustomerAccount, Label: '{i18n>fieldCustomerAccount}', ![@HTML5.CssDefaults]: {width: '11rem'} },
        { Value: CustomerName,    Label: '{i18n>fieldCustomerName}',    ![@HTML5.CssDefaults]: {width: '16rem'} },
        { Value: InvoiceAmount,   Label: '{i18n>fieldInvoiceAmount}',   ![@HTML5.CssDefaults]: {width: '9rem'} },
        { Value: ClearingStatus,  Label: '{i18n>fieldClearingStatus}',  ![@HTML5.CssDefaults]: {width: '10rem'} }
    ]
);

annotate service.IngestionLog with @(
    UI.HeaderInfo : {
        TypeName       : '{i18n>ingestionTypeName}',
        TypeNamePlural : '{i18n>ingestionTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: filename },
        Description    : { $Type: 'UI.DataField', Value: classificationDecision }
    },
    UI.SelectionFields : [
        source,
        classificationDecision
    ],
    UI.LineItem : [
        { Value: timestamp,              Label: '{i18n>fieldTimestamp}',              ![@HTML5.CssDefaults]: {width: '12rem'} },
        { Value: source,                 Label: '{i18n>fieldSource}',                 ![@HTML5.CssDefaults]: {width: '10rem'} },
        { Value: subject,                Label: '{i18n>fieldSubject}',                ![@HTML5.CssDefaults]: {width: '18rem'} },
        { Value: filename,               Label: '{i18n>fieldFilename}',               ![@HTML5.CssDefaults]: {width: '16rem'} },
        { Value: classificationDecision, Label: '{i18n>fieldClassificationDecision}', ![@HTML5.CssDefaults]: {width: '14rem'} }
    ],
    // Rendered inside the Payments Object Page 'Ingestion Log' tab
    UI.LineItem #ingestion : [
        { Value: timestamp,              Label: '{i18n>fieldTimestamp}',              ![@HTML5.CssDefaults]: {width: '12rem'} },
        { Value: source,                 Label: '{i18n>fieldSource}',                 ![@HTML5.CssDefaults]: {width: '10rem'} },
        { Value: subject,                Label: '{i18n>fieldSubject}',                ![@HTML5.CssDefaults]: {width: '18rem'} },
        { Value: filename,               Label: '{i18n>fieldFilename}',               ![@HTML5.CssDefaults]: {width: '16rem'} },
        { Value: classificationDecision, Label: '{i18n>fieldClassificationDecision}', ![@HTML5.CssDefaults]: {width: '14rem'} }
    ]
);
