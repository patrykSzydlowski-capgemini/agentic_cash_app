using CashSyncService as service from '../../../../srv/cat-service';

annotate service.IngestionLog with {
    ID                     @title: '{i18n>ingestionTypeName}';
    timestamp              @title: '{i18n>fieldTimestamp}';
    source                 @title: '{i18n>fieldSource}';
    messageId              @title: '{i18n>fieldMessageId}';
    subject                @title: '{i18n>fieldSubject}';
    filename               @title: '{i18n>fieldFilename}';
    classificationDecision @title: '{i18n>fieldClassificationDecision}';
    classificationReason   @title: '{i18n>fieldClassificationReason}';
};
