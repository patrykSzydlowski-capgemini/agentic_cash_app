namespace poc.cash;

using { cuid, managed } from '@sap/cds/common';
using { poc.cash.MatchResult } from './match-results';

entity OpenItem {
  key OpenItemId       : String(36);
      CompanyCode      : String(4);
      CustomerAccount  : String(10);
      CustomerName     : String(100);
      InvoiceAmount    : Decimal(15, 2);
      InvoiceAmountCurr: String(3);
      ClearingStatus   : String(20);
      PostingDate      : Date;
      DocumentDate     : Date;
      matches          : Association to many MatchResult on matches.open_item = $self;
}
