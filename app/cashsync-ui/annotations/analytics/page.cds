using CashSyncService as service from '../../../../srv/cat-service';

// Run detail page: everything the run measured, grouped by pipeline stage.
annotate service.PipelineRuns with @(
    UI.FieldGroup #RunOverview : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: trigger,      Label: '{i18n>fieldRunTrigger}' },
            { $Type: 'UI.DataField', Value: status,       Criticality: StatusCriticality, Label: '{i18n>fieldStatus}' },
            { $Type: 'UI.DataField', Value: startedAt,    Label: '{i18n>fieldRunStartedAt}' },
            { $Type: 'UI.DataField', Value: finishedAt,   Label: '{i18n>fieldRunFinishedAt}' },
            { $Type: 'UI.DataField', Value: durationMs,   Label: '{i18n>fieldRunDuration}' },
            { $Type: 'UI.DataField', Value: errorMessage, Label: '{i18n>fieldRunError}' }
        ]
    },
    UI.FieldGroup #RunVolumes : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: newMails,          Label: '{i18n>fieldRunNewMails}' },
            { $Type: 'UI.DataField', Value: pdfsReceived,      Label: '{i18n>fieldRunPdfsReceived}' },
            { $Type: 'UI.DataField', Value: filesExtracted,    Label: '{i18n>fieldRunFilesExtracted}' },
            { $Type: 'UI.DataField', Value: extractionFailed,  Label: '{i18n>fieldRunExtractionFailed}' },
            { $Type: 'UI.DataField', Value: erpLive,           Label: '{i18n>fieldRunErpLive}' },
            { $Type: 'UI.DataField', Value: openItemsSynced,   Label: '{i18n>fieldRunOpenItemsSynced}' },
            { $Type: 'UI.DataField', Value: openItemsOpen,     Label: '{i18n>fieldRunOpenItemsOpen}' },
            { $Type: 'UI.DataField', Value: openItemsAssessed, Label: '{i18n>fieldRunOpenItemsAssessed}' },
            { $Type: 'UI.DataField', Value: paymentsEvaluated, Label: '{i18n>fieldRunPaymentsEvaluated}' },
            { $Type: 'UI.DataField', Value: paymentsMatched,   Label: '{i18n>fieldRunPaymentsMatched}' },
            { $Type: 'UI.DataField', Value: paymentsReview,    Label: '{i18n>fieldRunPaymentsReview}' }
        ]
    },
    UI.FieldGroup #RunAiUsage : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: aiModel,          Label: '{i18n>fieldAiModel}' },
            { $Type: 'UI.DataField', Value: aiCalls,          Label: '{i18n>fieldRunAiCalls}' },
            { $Type: 'UI.DataField', Value: promptTokens,     Label: '{i18n>fieldPromptTokens}' },
            { $Type: 'UI.DataField', Value: completionTokens, Label: '{i18n>fieldCompletionTokens}' },
            { $Type: 'UI.DataField', Value: totalTokens,      Label: '{i18n>fieldTotalTokens}' },
            { $Type: 'UI.DataField', Value: extractionTokens, Label: '{i18n>fieldRunExtractionTokens}' },
            { $Type: 'UI.DataField', Value: matchingTokens,   Label: '{i18n>fieldRunMatchingTokens}' },
            { $Type: 'UI.DataField', Value: estimatedCost,    Label: '{i18n>fieldEstimatedCost}' },
            { $Type: 'UI.DataField', Value: capacityUnits,    Label: '{i18n>fieldCapacityUnits}' }
        ]
    },
    UI.FieldGroup #RunTimings : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: erpSyncMs,    Label: '{i18n>fieldRunErpSyncMs}' },
            { $Type: 'UI.DataField', Value: mailIntakeMs, Label: '{i18n>fieldRunMailIntakeMs}' },
            { $Type: 'UI.DataField', Value: extractionMs, Label: '{i18n>fieldRunExtractionMs}' },
            { $Type: 'UI.DataField', Value: matchingMs,   Label: '{i18n>fieldRunMatchingMs}' }
        ]
    },
    UI.Facets : [
        { $Type: 'UI.ReferenceFacet', ID: 'RunOverviewFacet', Label: '{i18n>facetRunOverview}', Target: '@UI.FieldGroup#RunOverview' },
        { $Type: 'UI.ReferenceFacet', ID: 'RunVolumesFacet',  Label: '{i18n>facetRunVolumes}',  Target: '@UI.FieldGroup#RunVolumes' },
        { $Type: 'UI.ReferenceFacet', ID: 'RunAiUsageFacet',  Label: '{i18n>facetRunAiUsage}',  Target: '@UI.FieldGroup#RunAiUsage' },
        { $Type: 'UI.ReferenceFacet', ID: 'RunTimingsFacet',  Label: '{i18n>facetRunTimings}',  Target: '@UI.FieldGroup#RunTimings' }
    ]
);
