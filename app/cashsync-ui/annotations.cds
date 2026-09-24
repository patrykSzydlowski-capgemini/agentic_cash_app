using CashSyncService as service from '../../srv/cat-service';

annotate service.Payments with @(
    Capabilities.DeleteRestrictions : { Deletable : true },
    Capabilities.InsertRestrictions : { Insertable : false },
    Capabilities.UpdateRestrictions : { Updatable : false },
    UI.HeaderInfo : {
        TypeName       : '{i18n>paymentTypeName}',
        TypeNamePlural : '{i18n>paymentTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: payer },
        Description    : { $Type: 'UI.DataField', Value: status }
    },
    UI.SelectionPresentationVariant #AllPayments : {
        Text : '{i18n>tabPayments}',
        SelectionVariant : {
            SelectOptions : []
        },
        PresentationVariant : {
            Visualizations : [
                '@UI.LineItem'
            ]
        }
    },
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
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.validateSampleDocument',
            Label  : '{i18n>actionValidateSample}'
        },
        { $Type: 'UI.DataField', Value: payer,                Label: '{i18n>fieldPayer}' },
        { $Type: 'UI.DataField', Value: amount,               Label: '{i18n>fieldAmount}' },
        { $Type: 'UI.DataField', Value: currency,             Label: '{i18n>fieldCurrency}' },
        { $Type: 'UI.DataField', Value: valueDate,            Label: '{i18n>fieldValueDate}' },
        { $Type: 'UI.DataField', Value: aiModel,              Label: '{i18n>fieldAiModel}' },
        { $Type: 'UI.DataField', Value: totalTokens,          Label: '{i18n>fieldTotalTokens}' },
        { $Type: 'UI.DataField', Value: estimatedCost,        Label: '{i18n>fieldEstimatedCost}' },
        { $Type: 'UI.DataField', Value: extractionConfidence, Label: '{i18n>fieldExtractionConfidence}' },
        { $Type: 'UI.DataField', Value: status,               Criticality: StatusCriticality, Label: '{i18n>fieldStatus}' },
        { $Type: 'UI.DataField', Value: rationale,            Label: '{i18n>fieldRationale}' }
    ],
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
        // FE-native tabs on the Payments Object Page anchor bar: each
        // association renders as a tab with its own LineItem table, no
        // custom navigation buttons needed (skill fiori-elements level 1).
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

annotate service.AiAnalytics with @(
    Capabilities.DeleteRestrictions : { Deletable : false },
    Capabilities.InsertRestrictions : { Insertable : false },
    Capabilities.UpdateRestrictions : { Updatable : false },
    UI.HeaderInfo : {
        TypeName       : '{i18n>aiAnalyticsTypeName}',
        TypeNamePlural : '{i18n>aiAnalyticsTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: payer },
        Description    : { $Type: 'UI.DataField', Value: aiModel }
    },
    UI.SelectionPresentationVariant #AiStats : {
        Text : '{i18n>tabAiAnalytics}',
        SelectionVariant : {
            SelectOptions : []
        },
        PresentationVariant : {
            SortOrder : [
                { Property : createdAt, Descending : true }
            ],
            Visualizations : [
                '@UI.LineItem'
            ]
        }
    },
    UI.SelectionFields : [
        aiModel,
        status
    ],
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: createdAt,            Label: '{i18n>fieldCreatedAt}' },
        { $Type: 'UI.DataField', Value: payer,                Label: '{i18n>fieldPayer}' },
        { $Type: 'UI.DataField', Value: amount,               Label: '{i18n>fieldAmount}' },
        { $Type: 'UI.DataField', Value: currency,             Label: '{i18n>fieldCurrency}' },
        { $Type: 'UI.DataField', Value: aiModel,              Label: '{i18n>fieldAiModel}' },
        { $Type: 'UI.DataField', Value: promptTokens,         Label: '{i18n>fieldPromptTokens}' },
        { $Type: 'UI.DataField', Value: completionTokens,     Label: '{i18n>fieldCompletionTokens}' },
        { $Type: 'UI.DataField', Value: totalTokens,          Label: '{i18n>fieldTotalTokens}' },
        { $Type: 'UI.DataField', Value: estimatedCost,        Label: '{i18n>fieldEstimatedCost}' },
        { $Type: 'UI.DataField', Value: capacityUnits,        Label: '{i18n>fieldCapacityUnits}' },
        { $Type: 'UI.DataField', Value: processingTimeMs,     Label: '{i18n>fieldProcessingTime}' },
        { $Type: 'UI.DataField', Value: extractionConfidence, Label: '{i18n>fieldExtractionConfidence}' },
        { $Type: 'UI.DataField', Value: status,               Criticality: StatusCriticality, Label: '{i18n>fieldStatus}' }
    ]
);

annotate service.ProposedMatches with @(
    Capabilities.DeleteRestrictions : { Deletable : true },
    Capabilities.InsertRestrictions : { Insertable : false },
    Capabilities.UpdateRestrictions : { Updatable : false },
    UI.HeaderInfo : {
        TypeName       : '{i18n>matchTypeName}',
        TypeNamePlural : '{i18n>matchTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: openItemId },
        Description    : { $Type: 'UI.DataField', Value: reviewStatus }
    },
    // Outcome panel: posting result fields shown with review criticality.
    UI.FieldGroup #PostingOutcome : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: reviewStatus,   Criticality: ReviewCriticality, Label: '{i18n>fieldReviewStatus}' },
            { $Type: 'UI.DataField', Value: postingId,      Label: '{i18n>fieldPostingId}' },
            { $Type: 'UI.DataField', Value: documentNumber, Label: '{i18n>fieldDocumentNumber}' },
            { $Type: 'UI.DataField', Value: postingError,   Label: '{i18n>fieldPostingError}' }
        ]
    },
    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'PostingOutcomeFacet',
            Label  : '{i18n>facetPostingOutcome}',
            Target : '@UI.FieldGroup#PostingOutcome'
        }
    ],
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: openItemId,   Label: '{i18n>fieldOpenItemId}' },
        { $Type: 'UI.DataField', Value: companyCode,  Label: '{i18n>fieldCompanyCode}' },
        { $Type: 'UI.DataField', Value: customerAccount, Label: '{i18n>fieldCustomerAccount}' },
        { $Type: 'UI.DataField', Value: amount,       Label: '{i18n>fieldAmount}' },
        { $Type: 'UI.DataField', Value: currency,     Label: '{i18n>fieldCurrency}' },
        { $Type: 'UI.DataField', Value: matchStatus,  Label: '{i18n>fieldMatchStatus}' },
        { $Type: 'UI.DataField', Value: matchScore,   Label: '{i18n>fieldMatchScore}' },
        { $Type: 'UI.DataField', Value: reviewStatus, Criticality: ReviewCriticality, Label: '{i18n>fieldReviewStatus}' },
        { $Type: 'UI.DataField', Value: rationale,    Label: '{i18n>fieldRationale}' },
        // Per-row review actions (reference per-row Approve/Reject on pending).
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.approveMatch',
            Label  : '{i18n>actionApprove}'
        },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.rejectMatch',
            Label  : '{i18n>actionReject}'
        }
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
        { Value: timestamp,              Label: '{i18n>fieldTimestamp}' },
        { Value: source,                 Label: '{i18n>fieldSource}' },
        { Value: subject,                Label: '{i18n>fieldSubject}' },
        { Value: filename,               Label: '{i18n>fieldFilename}' },
        { Value: classificationDecision, Label: '{i18n>fieldClassificationDecision}' }
    ],
    // Rendered inside the Payments Object Page 'Ingestion Log' tab
    UI.LineItem #ingestion : [
        { Value: timestamp,              Label: '{i18n>fieldTimestamp}' },
        { Value: source,                 Label: '{i18n>fieldSource}' },
        { Value: subject,                Label: '{i18n>fieldSubject}' },
        { Value: filename,               Label: '{i18n>fieldFilename}' },
        { Value: classificationDecision, Label: '{i18n>fieldClassificationDecision}' }
    ]
);

annotate service.OpenItem with @(
    UI.LineItem : [
        { Value: OpenItemId,      Label: '{i18n>fieldOpenItemId}' },
        { Value: CustomerAccount, Label: '{i18n>fieldCustomerAccount}' },
        { Value: CustomerName,    Label: '{i18n>fieldCustomerName}' },
        { Value: InvoiceAmount,   Label: '{i18n>fieldAmount}' },
        { Value: ClearingStatus,  Label: '{i18n>fieldClearingStatus}' }
    ]
);

// MatchResult list: review-action buttons restored with multi-selection support.
annotate service.MatchResult with @(
    Capabilities.DeleteRestrictions : { Deletable : true },
    Capabilities.InsertRestrictions : { Insertable : false },
    Capabilities.UpdateRestrictions : { Updatable : false },
    UI.HeaderInfo : {
        TypeName       : '{i18n>matchTypeName}',
        TypeNamePlural : '{i18n>matchTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: match_id }
    },
    UI.SelectionFields : [
        match_status,
        review_status,
        action_required
    ],
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: match_id,                Label: '{i18n>matchTypeName}' },
        { $Type: 'UI.DataField', Value: open_item.OpenItemId,    Label: '{i18n>fieldOpenItemId}' },
        { $Type: 'UI.DataField', Value: open_item.CustomerName,  Label: '{i18n>fieldCustomerName}' },
        { $Type: 'UI.DataField', Value: matched_amount,          Label: '{i18n>fieldAmount}' },
        { $Type: 'UI.DataField', Value: confidence,              Label: '{i18n>fieldExtractionConfidence}' },
        { $Type: 'UI.DataField', Value: match_status,            Criticality: CriticalityCode, Label: '{i18n>fieldStatus}' },
        { $Type: 'UI.DataField', Value: review_reason,           Label: '{i18n>fieldRationale}' },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.triggerAIAgent',
            Label  : '{i18n>actionReprocessWithAI}'
        },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.manualApprove',
            Label  : '{i18n>actionManualApprove}'
        }
    ]
);

annotate service.MatchResult actions {
    triggerAIAgent @(
        Common.SideEffects : {
            TargetProperties : [
                'confidence',
                'match_status',
                'action_required',
                'review_status',
                'review_reason',
                'CriticalityCode'
            ]
        }
    );
    manualApprove @(
        Common.SideEffects : {
            TargetProperties : [
                'match_status',
                'action_required',
                'review_status',
                'review_reason',
                'CriticalityCode'
            ]
        }
    );
};

annotate service.Payments actions {
    reprocessWithAI @(
        Common.SideEffects : {
            TargetProperties : [
                'status',
                'StatusCriticality',
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
                'StatusCriticality'
            ],
            TargetEntities : [
                'matches'
            ]
        }
    );
};

annotate service.ProposedMatches actions {
    approveMatch @(
        Common.SideEffects : {
            TargetProperties : [
                'reviewStatus',
                'ReviewCriticality',
                'postingId',
                'documentNumber',
                'postingError'
            ],
            TargetEntities : [
                'payment'
            ]
        }
    );
    rejectMatch @(
        Common.SideEffects : {
            TargetProperties : [
                'reviewStatus',
                'ReviewCriticality'
            ],
            TargetEntities : [
                'payment'
            ]
        }
    );
};
