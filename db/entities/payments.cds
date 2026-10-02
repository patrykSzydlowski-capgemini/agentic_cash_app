namespace poc.cashapp;

using { cuid, managed } from '@sap/cds/common';
using { poc.cashapp.ProposedMatches } from './proposed-matches';
using { poc.cashapp.IngestionLog } from './ingestion-log';

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
