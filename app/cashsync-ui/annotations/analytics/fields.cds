using CashSyncService as service from '../../../../srv/cat-service';

annotate service.PipelineRuns with {
    ID                @title: '{i18n>fieldRunId}' @UI.Hidden;
    startedAt         @title: '{i18n>fieldRunStartedAt}';
    finishedAt        @title: '{i18n>fieldRunFinishedAt}';
    durationMs        @title: '{i18n>fieldRunDuration}' @Measures.Unit: 'ms';
    trigger           @title: '{i18n>fieldRunTrigger}';
    status            @title: '{i18n>fieldStatus}'
                      @UI.Criticality: StatusCriticality
                      @UI.CriticalityRepresentation: #WithIcon;
    errorMessage      @title: '{i18n>fieldRunError}' @UI.MultiLineText;
    newMails          @title: '{i18n>fieldRunNewMails}';
    pdfsReceived      @title: '{i18n>fieldRunPdfsReceived}';
    filesExtracted    @title: '{i18n>fieldRunFilesExtracted}';
    extractionFailed  @title: '{i18n>fieldRunExtractionFailed}';
    erpLive           @title: '{i18n>fieldRunErpLive}';
    openItemsSynced   @title: '{i18n>fieldRunOpenItemsSynced}';
    openItemsOpen     @title: '{i18n>fieldRunOpenItemsOpen}';
    openItemsAssessed @title: '{i18n>fieldRunOpenItemsAssessed}';
    paymentsEvaluated @title: '{i18n>fieldRunPaymentsEvaluated}';
    paymentsMatched   @title: '{i18n>fieldRunPaymentsMatched}';
    paymentsReview    @title: '{i18n>fieldRunPaymentsReview}';
    aiCalls           @title: '{i18n>fieldRunAiCalls}';
    promptTokens      @title: '{i18n>fieldPromptTokens}';
    completionTokens  @title: '{i18n>fieldCompletionTokens}';
    totalTokens       @title: '{i18n>fieldTotalTokens}';
    extractionTokens  @title: '{i18n>fieldRunExtractionTokens}';
    matchingTokens    @title: '{i18n>fieldRunMatchingTokens}';
    estimatedCost     @title: '{i18n>fieldEstimatedCost}' @Measures.ISOCurrency: 'USD';
    capacityUnits     @title: '{i18n>fieldCapacityUnits}';
    aiModel           @title: '{i18n>fieldAiModel}';
    erpSyncMs         @title: '{i18n>fieldRunErpSyncMs}' @Measures.Unit: 'ms';
    mailIntakeMs      @title: '{i18n>fieldRunMailIntakeMs}' @Measures.Unit: 'ms';
    extractionMs      @title: '{i18n>fieldRunExtractionMs}' @Measures.Unit: 'ms';
    matchingMs        @title: '{i18n>fieldRunMatchingMs}' @Measures.Unit: 'ms';
    StatusCriticality @UI.Hidden;
};

annotate service.PipelineRuns with {
    trigger     @Common.Text: triggerText @Common.TextArrangement: #TextOnly;
    status      @Common.Text: statusText  @Common.TextArrangement: #TextOnly;
    triggerText @UI.Hidden;
    statusText  @UI.Hidden;
};
