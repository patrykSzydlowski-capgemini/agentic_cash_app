namespace poc.cash;

using { cuid, managed } from '@sap/cds/common';
using { poc.cash.MatchResult } from './match-results';
using { poc.cashapp.ProposedMatches } from './proposed-matches';

entity OpenItem {
  key OpenItemId       : String(36);
      CompanyCode      : String(4);
      CustomerAccount  : String(10);
      CustomerName     : String(100);
      InvoiceAmount    : Decimal(15, 2);
      InvoiceAmountCurr: String(3);
      ClearingStatus   : String(20) enum {
        @title: '{i18n>clearingStatusOpen}'
        OPEN;
        @title: '{i18n>clearingStatusCleared}'
        CLEARED;
      };
      PostingDate      : Date;
      DocumentDate     : Date;
      // S4 = synced from S/4HANA; LOCAL = local-only test item (kept by the sync, cleared locally, never posted to S/4).
      source           : String(10) enum {
        @title: '{i18n>openItemSourceS4}'
        S4;
        @title: '{i18n>openItemSourceLocal}'
        LOCAL;
      } default 'S4';
      // Agent 3 assessment: how sure the AI is that this item is paid (0..1, 1 = deterministic match).
      // Written by the pipeline only; S/4 sync uses UPSERT (PATCH semantics) and keeps these values.
      aiConfidence        : Decimal(3, 2);
      aiMatchStatus       : String enum {
        @title: '{i18n>matchStatusFull}'
        full;
        @title: '{i18n>matchStatusProbable}'
        probable;
        @title: '{i18n>matchStatusToBeChecked}'
        toBeChecked;
        @title: '{i18n>matchStatusNoMatch}'
        noMatch;
      };
      aiRationale         : LargeString;
      matchedPaymentCount : Integer;
      matchedAmount       : Decimal(15, 2);
      assessedAt          : Timestamp;
      // Soft delete from the UI ("Delete" on Open/Closed Items): hidden from the
      // service and the matching pool; S/4 sync (UPSERT) never resets it.
      dismissed           : Boolean default false;
      matches          : Association to many MatchResult on matches.open_item = $self;
      proposedMatches  : Association to many ProposedMatches on proposedMatches.openItemId = OpenItemId;
}
