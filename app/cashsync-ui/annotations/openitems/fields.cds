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
