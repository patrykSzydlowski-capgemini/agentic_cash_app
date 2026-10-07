using CashSyncService as service from '../../../../srv/cat-service';

annotate service.PipelineRuns with @(
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: startedAt,         Label: '{i18n>fieldRunStartedAt}',         ![@HTML5.CssDefaults]: {width: '12rem'} },
        { $Type: 'UI.DataField', Value: trigger,           Label: '{i18n>fieldRunTrigger}',           ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: status,            Criticality: StatusCriticality, Label: '{i18n>fieldStatus}', ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: durationMs,        Label: '{i18n>fieldRunDuration}',          ![@HTML5.CssDefaults]: {width: '8rem'} },
        { $Type: 'UI.DataField', Value: totalTokens,       Label: '{i18n>fieldTotalTokens}',          ![@HTML5.CssDefaults]: {width: '8rem'} },
        { $Type: 'UI.DataField', Value: aiCalls,           Label: '{i18n>fieldRunAiCalls}',           ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: estimatedCost,     Label: '{i18n>fieldEstimatedCost}',        ![@HTML5.CssDefaults]: {width: '8rem'} },
        { $Type: 'UI.DataField', Value: pdfsReceived,      Label: '{i18n>fieldRunPdfsReceived}',      ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: filesExtracted,    Label: '{i18n>fieldRunFilesExtracted}',    ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: openItemsOpen,     Label: '{i18n>fieldRunOpenItemsOpen}',     ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: paymentsEvaluated, Label: '{i18n>fieldRunPaymentsEvaluated}', ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: paymentsMatched,   Label: '{i18n>fieldRunPaymentsMatched}',   ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: paymentsReview,    Label: '{i18n>fieldRunPaymentsReview}',    ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: erpLive,           Label: '{i18n>fieldRunErpLive}',           ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: aiModel,           Label: '{i18n>fieldAiModel}',              ![@HTML5.CssDefaults]: {width: '11rem'} }
    ]
);
