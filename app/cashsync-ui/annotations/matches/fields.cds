using CashSyncService as service from '../../../../srv/cat-service';

annotate service.ProposedMatches with {
    ID             @title: '{i18n>matchTypeName}';
    openItemId     @title: '{i18n>fieldOpenItemId}';
    companyCode    @title: '{i18n>fieldCompanyCode}';
    customerAccount @title: '{i18n>fieldCustomerAccount}';
    amount         @title: '{i18n>fieldAmount}';
    currency       @title: '{i18n>fieldCurrency}';
    matchStatus    @title: '{i18n>fieldMatchStatus}';
    reviewStatus   @title: '{i18n>fieldReviewStatus}';
    matchScore     @title: '{i18n>fieldMatchScore}';
    rationale      @title: '{i18n>fieldRationale}';
    postingId      @title: '{i18n>fieldPostingId}';
    documentNumber @title: '{i18n>fieldDocumentNumber}';
    postingError   @title: '{i18n>fieldPostingError}';
    createdAt      @title: '{i18n>fieldCreatedAt}';
    createdBy      @title: '{i18n>fieldCreatedBy}';
    modifiedAt     @title: '{i18n>fieldModifiedAt}';
    modifiedBy     @title: '{i18n>fieldModifiedBy}';
};
