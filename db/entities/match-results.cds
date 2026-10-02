namespace poc.cash;

using { cuid, managed } from '@sap/cds/common';
using { poc.cash.OpenItem } from './open-items';
using { poc.cash.ManualTask } from './manual-tasks';

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
