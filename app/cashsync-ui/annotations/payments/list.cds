using CashSyncService as service from '../../../../srv/cat-service';

annotate service.Payments with @(
    // Matching queue: filter by AI outcome / review state.
    UI.SelectionFields : [
        status,
        aiModel
    ],
    UI.Identification : [
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.postToS4',
            Label  : '{i18n>actionPostToS4}'
        },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.reprocessWithAI',
            Label  : '{i18n>actionReprocessWithAI}'
        }
    ],
    UI.LineItem : [
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.postToS4',
            Label  : '{i18n>actionPostToS4}'
        },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.reprocessWithAI',
            Label  : '{i18n>actionReprocessWithAI}'
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
        { $Type: 'UI.DataField', Value: aiModel,              Label: '{i18n>fieldAiModel}',              ![@HTML5.CssDefaults]: {width: '12rem'} },
        { $Type: 'UI.DataField', Value: totalTokens,          Label: '{i18n>fieldTotalTokens}',          ![@HTML5.CssDefaults]: {width: '8rem'} },
        { $Type: 'UI.DataField', Value: processingTimeMs,     Label: '{i18n>fieldProcessingTime}',       ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: rationale,            Label: '{i18n>fieldRationale}',            ![@HTML5.CssDefaults]: {width: '24rem'} }
    ]
);
