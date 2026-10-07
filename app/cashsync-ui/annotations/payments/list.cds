using CashSyncService as service from '../../../../srv/cat-service';

annotate service.Payments with @(
    // Matching queue: filter by AI outcome / review state.
    UI.SelectionFields : [
        status,
        aiModel
    ],
    // Posting happens on the open item (OpenItem object page), not here.
    UI.LineItem : [
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.EntityContainer/syncMailbox',
            Label  : '{i18n>actionSyncMailbox}'
        },
        { $Type: 'UI.DataField', Value: payer,                Label: '{i18n>fieldPayer}',                ![@HTML5.CssDefaults]: {width: '16rem'} },
        { $Type: 'UI.DataField', Value: amount,               Label: '{i18n>fieldAmount}',               ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: valueDate,            Label: '{i18n>fieldValueDate}',            ![@HTML5.CssDefaults]: {width: '9rem'} },
        {
            $Type                     : 'UI.DataFieldForAnnotation',
            Target                    : '@UI.DataPoint#ExtractionConfidence',
            Label                     : '{i18n>fieldExtractionConfidence}',
            CriticalityRepresentation : #WithoutIcon,
            ![@HTML5.CssDefaults]     : {width: '11rem'}
        },
        {
            $Type                     : 'UI.DataField',
            Value                     : status,
            Criticality               : StatusCriticality,
            CriticalityRepresentation : #WithIcon,
            Label                     : '{i18n>fieldStatus}',
            ![@HTML5.CssDefaults]     : {width: '11rem'}
        },
        { $Type: 'UI.DataField', Value: fileName,             Label: '{i18n>fieldFilename}',             ![@HTML5.CssDefaults]: {width: '18rem'} },
        { $Type: 'UI.DataField', Value: createdAt,            Label: '{i18n>fieldCreatedAt}',            ![@HTML5.CssDefaults]: {width: '12rem'} }
    ]
);
