// Imported from AlexanderX/ts-agentic-poc (Apache-2.0), namespace poc.cashapp.
// Kept as a separate namespace alongside poc.cash; existing data untouched.
namespace poc.cashapp;

using { cuid, managed } from '@sap/cds/common';

entity Payments : cuid, managed {
  payer      : String(140);
  amount     : Decimal(15, 2);
  currency   : String(3);
  valueDate  : Date;
  references : array of String;
  // Agent 2's self-reported confidence (0.00-1.00), persisted as-is; policy
  // decisions (e.g. routing to review) belong to the service layer.
  extractionConfidence : Decimal(3, 2);
  status     : String enum {
    @title: '{i18n>statusExtracted}'
    extracted;
    @title: '{i18n>statusMatched}'
    matched;
    @title: '{i18n>statusNeedsReview}'
    needsReview;
    @title: '{i18n>statusCleared}'
    cleared;
    @title: '{i18n>statusFailed}'
    failed;
  } default 'extracted';
  rationale  : LargeString;
  // AI execution analytics (tokens, costs, performance)
  promptTokens       : Integer;
  completionTokens   : Integer;
  totalTokens        : Integer;
  estimatedCost      : Decimal(10, 4);
  capacityUnits      : Decimal(10, 4);
  aiModel            : String(80);
  processingTimeMs   : Integer;
  matches    : Composition of many ProposedMatches on matches.payment = $self;
  // FE-native Object Page tabs (UI.ReferenceFacet): each to-many nav prop
  // renders as a tab with its own LineItem table, no custom nav buttons.
  ingestion  : Association to many IngestionLog on ingestion.payment = $self;
}

entity ProposedMatches : cuid, managed {
  payment      : Association to Payments;
  openItemId   : String(36);
  companyCode  : String(4);
  // Carried over from the matched open item at proposal time so the approve()
  // action has everything postClearing needs without a second read.
  customerAccount : String(10);
  amount          : Decimal(15, 2);
  currency        : String(3);
  matchStatus  : String enum {
    @title: '{i18n>matchStatusFull}'
    full;
    @title: '{i18n>matchStatusProbable}'
    probable;
    @title: '{i18n>matchStatusToBeChecked}'
    toBeChecked;
    @title: '{i18n>matchStatusNoMatch}'
    noMatch;
  };
  reviewStatus : String enum {
    @title: '{i18n>reviewStatusPending}'
    pending;
    @title: '{i18n>reviewStatusApproved}'
    approved;
    @title: '{i18n>reviewStatusRejected}'
    rejected;
    @title: '{i18n>reviewStatusPosted}'
    posted;
  } default 'pending';
  matchScore   : Decimal(3, 2);
  rationale    : LargeString;
  postingId      : String(36);
  documentNumber : String(10);
  // Populated only when reviewStatus stays 'approved' after a failed
  // postClearing call.
  postingError   : LargeString;
}

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
