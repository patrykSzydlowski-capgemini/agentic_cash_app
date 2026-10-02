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
  subject               : String(255);
  filename              : String(255);
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
