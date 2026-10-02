namespace poc.cashapp;

using { cuid, managed } from '@sap/cds/common';
using { poc.cashapp.Payments } from './payments';

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
