using CashSyncService as service from '../../../../srv/cat-service';

annotate service.OpenItem with {
    OpenItemId        @title: '{i18n>fieldOpenItemId}';
    CompanyCode       @title: '{i18n>fieldCompanyCode}';
    CustomerAccount   @title: '{i18n>fieldCustomerAccount}';
    CustomerName      @title: '{i18n>fieldCustomerName}';
    InvoiceAmount     @title: '{i18n>fieldInvoiceAmount}';
    InvoiceAmountCurr @title: '{i18n>fieldCurrency}';
    ClearingStatus    @title: '{i18n>fieldClearingStatus}';
    PostingDate       @title: '{i18n>fieldPostingDate}';
    DocumentDate      @title: '{i18n>fieldDocumentDate}';
};

annotate service.IngestionLog with {
    ID                     @title: '{i18n>ingestionTypeName}';
    timestamp              @title: '{i18n>fieldTimestamp}';
    source                 @title: '{i18n>fieldSource}';
    subject                @title: '{i18n>fieldSubject}';
    filename               @title: '{i18n>fieldFilename}';
    classificationDecision @title: '{i18n>fieldClassificationDecision}';
    classificationReason   @title: '{i18n>fieldClassificationReason}';
};
