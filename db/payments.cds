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
  status     : String enum { extracted; matched; cleared; } default 'extracted';
  matches    : Composition of many ProposedMatches on matches.payment = $self;
}

entity ProposedMatches : cuid, managed {
  payment      : Association to Payments;
  openItemId   : String(36);
  companyCode  : String(4);
  matchStatus  : String enum { full; probable; toBeChecked; noMatch; };
  reviewStatus : String enum { pending; approved; rejected; posted; } default 'pending';
  matchScore   : Decimal(3, 2);
  rationale    : LargeString;
  postingId      : String(36);
  documentNumber : String(10);
}

entity IngestionLog : cuid {
  timestamp             : Timestamp;
  source                : String enum { mailbox; bankFeed; };
  subject               : String(255);
  filename              : String(255);
  classificationDecision : String enum { relevant; notRelevant; needsReview; };
  classificationReason  : LargeString;
  payment               : Association to Payments;
}
