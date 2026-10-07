using CashSyncService as service from '../../../../srv/cat-service';

annotate service.Payments with {
    ID                   @title: '{i18n>fieldPaymentId}';
    payer                @title: '{i18n>fieldPayer}';
    amount               @title: '{i18n>fieldAmount}' @Measures.ISOCurrency: currency;
    currency             @title: '{i18n>fieldCurrency}';
    valueDate            @title: '{i18n>fieldValueDate}';
    references           @title: '{i18n>fieldReferences}';
    aiModel              @title: '{i18n>fieldAiModel}';
    promptTokens         @title: '{i18n>fieldPromptTokens}';
    completionTokens     @title: '{i18n>fieldCompletionTokens}';
    totalTokens          @title: '{i18n>fieldTotalTokens}';
    estimatedCost        @title: '{i18n>fieldEstimatedCost}';
    capacityUnits        @title: '{i18n>fieldCapacityUnits}';
    extractionConfidence @title: '{i18n>fieldExtractionConfidence}'
                         @UI.Criticality: ConfidenceCriticality
                         @UI.CriticalityRepresentation: #WithoutIcon;
    status               @title: '{i18n>fieldStatus}'
                         @UI.Criticality: StatusCriticality
                         @UI.CriticalityRepresentation: #WithIcon
                         @Common.Text: statusText
                         @Common.TextArrangement: #TextOnly;
    rationale            @title: '{i18n>fieldRationale}';
    processingTimeMs     @title: '{i18n>fieldProcessingTime}';
    createdAt            @title: '{i18n>fieldCreatedAt}';
    createdBy            @title: '{i18n>fieldCreatedBy}';
    modifiedAt           @title: '{i18n>fieldModifiedAt}';
    modifiedBy           @title: '{i18n>fieldModifiedBy}';
};

annotate service.Payments with @(
    UI.DataPoint #PaymentAmount : {
        Value       : amount,
        Title       : '{i18n>fieldAmount}',
        Criticality : StatusCriticality
    },
    UI.DataPoint #ExtractionConfidence : {
        Value                     : extractionConfidence,
        Title                     : '{i18n>fieldExtractionConfidence}',
        TargetValue               : 1.0,
        Visualization             : #Progress,
        Criticality               : ConfidenceCriticality,
        CriticalityRepresentation : #WithoutIcon
    },
    UI.DataPoint #TotalTokens : {
        Value : totalTokens,
        Title : '{i18n>fieldTotalTokens}'
    },
    UI.DataPoint #ProcessingTime : {
        Value : processingTimeMs,
        Title : '{i18n>fieldProcessingTime}'
    },
    UI.DataPoint #EstimatedCost : {
        Value : estimatedCost,
        Title : '{i18n>fieldEstimatedCost}'
    },
    UI.DataPoint #AiModel : {
        Value : aiModel,
        Title : '{i18n>fieldAiModel}'
    }
);

