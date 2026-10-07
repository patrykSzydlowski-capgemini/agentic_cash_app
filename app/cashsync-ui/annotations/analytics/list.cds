using CashSyncService as service from '../../../../srv/cat-service';

annotate service.AiAnalytics with @(
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: createdAt,            Label: '{i18n>fieldCreatedAt}',            ![@HTML5.CssDefaults]: {width: '12rem'} },
        { $Type: 'UI.DataField', Value: payer,                Label: '{i18n>fieldPayer}',                ![@HTML5.CssDefaults]: {width: '16rem'} },
        { $Type: 'UI.DataField', Value: amount,               Label: '{i18n>fieldAmount}',               ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: aiModel,              Label: '{i18n>fieldAiModel}',              ![@HTML5.CssDefaults]: {width: '12rem'} },
        { $Type: 'UI.DataField', Value: promptTokens,         Label: '{i18n>fieldPromptTokens}',         ![@HTML5.CssDefaults]: {width: '8rem'} },
        { $Type: 'UI.DataField', Value: completionTokens,     Label: '{i18n>fieldCompletionTokens}',     ![@HTML5.CssDefaults]: {width: '8rem'} },
        { $Type: 'UI.DataField', Value: totalTokens,          Label: '{i18n>fieldTotalTokens}',          ![@HTML5.CssDefaults]: {width: '8rem'} },
        { $Type: 'UI.DataField', Value: estimatedCost,        Label: '{i18n>fieldEstimatedCost}',        ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: capacityUnits,        Label: '{i18n>fieldCapacityUnits}',        ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: processingTimeMs,     Label: '{i18n>fieldProcessingTime}',       ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: extractionConfidence, Label: '{i18n>fieldExtractionConfidence}', ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: status,               Criticality: StatusCriticality, Label: '{i18n>fieldStatus}', ![@HTML5.CssDefaults]: {width: '10rem'} }
    ]
);
