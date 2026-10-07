using CashSyncService as service from '../../../../srv/cat-service';

annotate service.OpenItem with {
    OpenItemId          @title: '{i18n>fieldOpenItemId}';
    CompanyCode         @title: '{i18n>fieldCompanyCode}';
    CustomerAccount     @title: '{i18n>fieldCustomerAccount}';
    CustomerName        @title: '{i18n>fieldCustomerName}';
    InvoiceAmount       @title: '{i18n>fieldInvoiceAmount}' @Measures.ISOCurrency: InvoiceAmountCurr;
    InvoiceAmountCurr   @title: '{i18n>fieldCurrency}';
    ClearingStatus      @title: '{i18n>fieldClearingStatus}' @UI.Criticality: ClearingCriticality @UI.CriticalityRepresentation: #WithIcon;
    PostingDate         @title: '{i18n>fieldPostingDate}';
    DocumentDate        @title: '{i18n>fieldDocumentDate}';
    source              @title: '{i18n>fieldOpenItemSource}' @Common.Text: sourceText @Common.TextArrangement: #TextOnly;
    sourceText          @UI.Hidden;
    aiConfidence        @title: '{i18n>fieldAiPaidConfidence}';
    aiConfidencePercent @title: '{i18n>fieldAiPaidConfidence}' @Measures.Unit: '%';
    dismissed           @UI.Hidden;
    aiMatchStatus       @title: '{i18n>fieldAiMatchStatus}' @UI.Criticality: ConfidenceCriticality @UI.CriticalityRepresentation: #WithIcon;
    aiRationale         @title: '{i18n>fieldAiRationale}' @UI.MultiLineText;
    matchedPaymentCount @title: '{i18n>fieldMatchedPaymentCount}';
    matchedAmount       @title: '{i18n>fieldMatchedAmount}' @Measures.ISOCurrency: InvoiceAmountCurr;
    assessedAt          @title: '{i18n>fieldAssessedAt}';
    ConfidenceCriticality @UI.Hidden;
    ClearingCriticality   @UI.Hidden;
};

annotate service.OpenItem with @(
    // 0..100 integer: a missing assessment shows "0 %", not "of 1".
    UI.DataPoint #AiConfidence : {
        Value                     : aiConfidencePercent,
        Title                     : '{i18n>fieldAiPaidConfidence}',
        TargetValue               : 100,
        Visualization             : #Progress,
        Criticality               : ConfidenceCriticality,
        CriticalityRepresentation : #WithoutIcon
    },
    UI.DataPoint #InvoiceAmount : {
        Value : InvoiceAmount,
        Title : '{i18n>fieldInvoiceAmount}'
    },
    UI.DataPoint #MatchedAmount : {
        Value : matchedAmount,
        Title : '{i18n>fieldMatchedAmount}'
    }
);
