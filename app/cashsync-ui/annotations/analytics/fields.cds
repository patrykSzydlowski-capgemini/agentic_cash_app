using CashSyncService as service from '../../../../srv/cat-service';

annotate service.AiAnalytics with {
    ID                   @title: '{i18n>fieldPaymentId}';
    createdAt            @title: '{i18n>fieldCreatedAt}';
    payer                @title: '{i18n>fieldPayer}';
    amount               @title: '{i18n>fieldAmount}' @Measures.ISOCurrency: currency;
    currency             @title: '{i18n>fieldCurrency}';
    valueDate            @title: '{i18n>fieldValueDate}';
    aiModel              @title: '{i18n>fieldAiModel}';
    promptTokens         @title: '{i18n>fieldPromptTokens}';
    completionTokens     @title: '{i18n>fieldCompletionTokens}';
    totalTokens          @title: '{i18n>fieldTotalTokens}';
    estimatedCost        @title: '{i18n>fieldEstimatedCost}';
    capacityUnits        @title: '{i18n>fieldCapacityUnits}';
    processingTimeMs     @title: '{i18n>fieldProcessingTime}';
    extractionConfidence @title: '{i18n>fieldExtractionConfidence}';
    status               @title: '{i18n>fieldStatus}'
                         @UI.Criticality: StatusCriticality
                         @UI.CriticalityRepresentation: #WithIcon
                         @Common.Text: statusText
                         @Common.TextArrangement: #TextOnly;
    modifiedAt           @title: '{i18n>fieldModifiedAt}';
};
