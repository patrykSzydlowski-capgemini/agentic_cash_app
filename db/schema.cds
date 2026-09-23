namespace poc.cash;

using { cuid, managed } from '@sap/cds/common';

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

entity MatchResult {
  key match_id        : String(36);
      open_item       : Association to OpenItem;
      match_status    : String(20);
      matched_amount  : Decimal(15, 2);
      variance_amount : Decimal(15, 2);
      confidence      : Decimal(5, 2);
      review_reason   : String(500);
      source_label    : String(50);
      action_required : Boolean;
      review_status   : String(20);
      tasks           : Association to many ManualTask on tasks.match = $self;
}

entity ManualTask {
  key task_id        : String(36);
      match          : Association to MatchResult;
      assigned_to    : String(100);
      priority       : String(20);
      status         : String(20);
      comments       : String(500);
}