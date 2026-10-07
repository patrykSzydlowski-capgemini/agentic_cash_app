namespace poc.cashapp;

using { cuid } from '@sap/cds/common';
using { poc.cashapp.Payments } from './payments';

entity IngestionLog : cuid {
  timestamp             : Timestamp;
  source                : String enum {
    @title: '{i18n>sourceMailbox}'
    mailbox;
    @title: '{i18n>sourceBankFeed}'
    bankFeed;
  };
  messageId             : String(255);
  sender                : String(255);
  subject               : String(255);
  filename              : String(255);
  attachmentContent     : LargeBinary @Core.MediaType: 'application/pdf';
  bodyText              : LargeString;
  processingStatus      : String enum {
    @title: '{i18n>processingStatusReceived}'
    received;
    @title: '{i18n>processingStatusExtracted}'
    extracted;
    @title: '{i18n>processingStatusFailed}'
    failed;
  } default 'received';
  classificationDecision : String enum {
    @title: '{i18n>decisionRelevant}'
    relevant;
    @title: '{i18n>decisionNotRelevant}'
    notRelevant;
    @title: '{i18n>decisionNeedsReview}'
    needsReview;
  };
  classificationReason  : LargeString;
  payment               : Association to Payments;
}
