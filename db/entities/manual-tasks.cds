namespace poc.cash;

using { cuid, managed } from '@sap/cds/common';
using { poc.cash.MatchResult } from './match-results';

entity ManualTask {
  key task_id        : String(36);
      match          : Association to MatchResult;
      assigned_to    : String(100);
      priority       : String(20);
      status         : String(20);
      comments       : String(500);
}
