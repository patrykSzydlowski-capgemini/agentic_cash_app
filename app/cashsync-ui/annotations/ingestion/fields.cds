using CashSyncService as service from '../../../../srv/cat-service';

annotate service.IngestionLog with {
    ID                     @title: '{i18n>ingestionTypeName}';
    timestamp              @title: '{i18n>fieldTimestamp}';
    source                 @title: '{i18n>fieldSource}';
    messageId              @title: '{i18n>fieldMessageId}';
    sender                 @title: '{i18n>fieldSender}';
    processingStatus       @title: '{i18n>fieldProcessingStatus}' @UI.Criticality: ProcessingCriticality @UI.CriticalityRepresentation: #WithIcon;
    bodyText               @title: '{i18n>fieldBodyText}' @UI.MultiLineText;
    ProcessingCriticality  @UI.Hidden;
    DecisionCriticality    @UI.Hidden;
    subject                @title: '{i18n>fieldSubject}';
    filename               @title: '{i18n>fieldFilename}';
    classificationDecision @title: '{i18n>fieldClassificationDecision}' @UI.Criticality: DecisionCriticality @UI.CriticalityRepresentation: #WithIcon;
    classificationReason   @title: '{i18n>fieldClassificationReason}';
};
