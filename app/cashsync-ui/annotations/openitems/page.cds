using CashSyncService as service from '../../../../srv/cat-service';

annotate service.OpenItem with @(
    UI.FieldGroup #AiAssessment : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: aiMatchStatus,       Criticality: ConfidenceCriticality, Label: '{i18n>fieldAiMatchStatus}' },
            { $Type: 'UI.DataField', Value: aiConfidence,        Label: '{i18n>fieldAiPaidConfidence}' },
            { $Type: 'UI.DataField', Value: matchedPaymentCount, Label: '{i18n>fieldMatchedPaymentCount}' },
            { $Type: 'UI.DataField', Value: matchedAmount,       Label: '{i18n>fieldMatchedAmount}' },
            { $Type: 'UI.DataField', Value: assessedAt,          Label: '{i18n>fieldAssessedAt}' },
            { $Type: 'UI.DataField', Value: aiRationale,         Label: '{i18n>fieldAiRationale}' }
        ]
    },
    UI.FieldGroup #InvoiceDetails : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: CustomerName,    Label: '{i18n>fieldCustomerName}' },
            { $Type: 'UI.DataField', Value: CustomerAccount, Label: '{i18n>fieldCustomerAccount}' },
            { $Type: 'UI.DataField', Value: CompanyCode,     Label: '{i18n>fieldCompanyCode}' },
            { $Type: 'UI.DataField', Value: InvoiceAmount,   Label: '{i18n>fieldInvoiceAmount}' },
            { $Type: 'UI.DataField', Value: ClearingStatus,  Criticality: ClearingCriticality, Label: '{i18n>fieldClearingStatus}' },
            { $Type: 'UI.DataField', Value: PostingDate,     Label: '{i18n>fieldPostingDate}' },
            { $Type: 'UI.DataField', Value: DocumentDate,    Label: '{i18n>fieldDocumentDate}' }
        ]
    },
    UI.HeaderFacets : [
        { $Type: 'UI.ReferenceFacet', ID: 'HeaderInvoiceAmountFacet', Target: '@UI.DataPoint#InvoiceAmount' },
        { $Type: 'UI.ReferenceFacet', ID: 'HeaderAiConfidenceFacet',  Target: '@UI.DataPoint#AiConfidence' },
        { $Type: 'UI.ReferenceFacet', ID: 'HeaderMatchedAmountFacet', Target: '@UI.DataPoint#MatchedAmount' }
    ],
    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'AiAssessmentFacet',
            Label  : '{i18n>facetOpenItemAiAssessment}',
            Target : '@UI.FieldGroup#AiAssessment'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'InvoiceDetailsFacet',
            Label  : '{i18n>facetOpenItemDetails}',
            Target : '@UI.FieldGroup#InvoiceDetails'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'PaymentEvidenceFacet',
            Label  : '{i18n>facetOpenItemPayments}',
            Target : 'proposedMatches/@UI.LineItem#OpenItemEvidence'
        }
    ]
);

// Payments (from remittance mails) that Agent 3 linked to this open item; review happens on the payment.
annotate service.ProposedMatches with @(
    UI.LineItem #OpenItemEvidence : [
        { $Type: 'UI.DataField', Value: payment.payer,     Label: '{i18n>fieldPayer}',        ![@HTML5.CssDefaults]: {width: '14rem'} },
        { $Type: 'UI.DataField', Value: payment.valueDate, Label: '{i18n>fieldValueDate}',    ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: amount,            Label: '{i18n>fieldAmount}',       ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: matchStatus,       Label: '{i18n>fieldMatchStatus}',  ![@HTML5.CssDefaults]: {width: '12rem'} },
        { $Type: 'UI.DataFieldForAnnotation', Target: '@UI.DataPoint#MatchScoreProgress', Label: '{i18n>fieldMatchScore}', ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: reviewStatus,      Criticality: ReviewCriticality, Label: '{i18n>fieldReviewStatus}', ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: rationale,         Label: '{i18n>fieldRationale}',    ![@HTML5.CssDefaults]: {width: '28rem'} }
    ]
);
