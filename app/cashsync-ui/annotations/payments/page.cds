using CashSyncService as service from '../../../../srv/cat-service';

annotate service.Payments with @(
    UI.FieldGroup #PaymentDetails : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: payer,                Label: '{i18n>fieldPayer}' },
            { $Type: 'UI.DataField', Value: amount,               Label: '{i18n>fieldAmount}' },
            { $Type: 'UI.DataField', Value: currency,             Label: '{i18n>fieldCurrency}' },
            { $Type: 'UI.DataField', Value: valueDate,            Label: '{i18n>fieldValueDate}' },
            { $Type: 'UI.DataField', Value: extractionConfidence, Label: '{i18n>fieldExtractionConfidence}' },
            { $Type: 'UI.DataField', Value: status,               Label: '{i18n>fieldStatus}' },
            { $Type: 'UI.DataField', Value: rationale,            Label: '{i18n>fieldRationale}' }
        ]
    },
    UI.FieldGroup #AiAnalyticsGroup : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: aiModel,            Label: '{i18n>fieldAiModel}' },
            { $Type: 'UI.DataField', Value: promptTokens,       Label: '{i18n>fieldPromptTokens}' },
            { $Type: 'UI.DataField', Value: completionTokens,   Label: '{i18n>fieldCompletionTokens}' },
            { $Type: 'UI.DataField', Value: totalTokens,        Label: '{i18n>fieldTotalTokens}' },
            { $Type: 'UI.DataField', Value: estimatedCost,      Label: '{i18n>fieldEstimatedCost}' },
            { $Type: 'UI.DataField', Value: processingTimeMs,   Label: '{i18n>fieldProcessingTime}' },
            { $Type: 'UI.DataField', Value: extractionConfidence, Label: '{i18n>fieldExtractionConfidence}' }
        ]
    },
    UI.HeaderFacets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'HeaderAmountFacet',
            Target : '@UI.DataPoint#PaymentAmount'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'HeaderConfidenceFacet',
            Target : '@UI.DataPoint#ExtractionConfidence'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'HeaderProcessingTimeFacet',
            Target : '@UI.DataPoint#ProcessingTime'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'HeaderTokensFacet',
            Target : '@UI.DataPoint#TotalTokens'
        }
    ],
    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'PaymentDetailsFacet',
            Label  : '{i18n>facetPaymentDetails}',
            Target : '@UI.FieldGroup#PaymentDetails'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'AiAnalyticsFacet',
            Label  : '{i18n>facetAiAnalytics}',
            Target : '@UI.FieldGroup#AiAnalyticsGroup'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'MatchesFacet',
            Label  : '{i18n>facetProposedMatches}',
            Target : 'matches/@UI.LineItem'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'IngestionFacet',
            Label  : '{i18n>facetIngestionLog}',
            Target : 'ingestion/@UI.LineItem#ingestion'
        }
    ]
);

annotate service.Payments actions {
    reprocessWithAI @(
        Common.SideEffects : {
            TargetProperties : [
                'status',
                'StatusCriticality',
                'statusText',
                'ConfidenceCriticality',
                'extractionConfidence',
                'rationale',
                'promptTokens',
                'completionTokens',
                'totalTokens',
                'estimatedCost',
                'aiModel',
                'processingTimeMs'
            ],
            TargetEntities : [
                'matches'
            ]
        }
    );
    postToS4 @(
        Common.SideEffects : {
            TargetProperties : [
                'status',
                'StatusCriticality',
                'statusText',
                'ConfidenceCriticality',
                'extractionConfidence'
            ],
            TargetEntities : [
                'matches'
            ]
        }
    );
};
