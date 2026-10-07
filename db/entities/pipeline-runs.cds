namespace poc.cashapp;

using { cuid } from '@sap/cds/common';

// One row per 3-agent pipeline run (startup, mail sync, revalidation, upload).
// Written by srv/cat-service.ts only; drives the "AI Agent Performance" tab.
entity PipelineRuns : cuid {
  startedAt         : Timestamp;
  finishedAt        : Timestamp;
  durationMs        : Integer;
  trigger           : String enum {
    @title: '{i18n>runTriggerStartup}'
    startup;
    @title: '{i18n>runTriggerMailSync}'
    mailSync;
    @title: '{i18n>runTriggerRevalidation}'
    revalidation;
    @title: '{i18n>runTriggerUpload}'
    upload;
    @title: '{i18n>runTriggerReprocess}'
    reprocess;
  };
  status            : String enum {
    @title: '{i18n>runStatusRunning}'
    running;
    @title: '{i18n>runStatusCompleted}'
    completed;
    @title: '{i18n>runStatusFailed}'
    failed;
  } default 'running';
  errorMessage      : LargeString;
  // Agent 1 — mailbox intake
  newMails          : Integer default 0;
  pdfsReceived      : Integer default 0;
  // Agent 2 — extraction
  filesExtracted    : Integer default 0;
  extractionFailed  : Integer default 0;
  // S/4HANA open items
  erpLive           : Boolean;
  openItemsSynced   : Integer default 0;
  openItemsOpen     : Integer default 0;
  openItemsAssessed : Integer default 0;
  // Agent 3 — matching
  paymentsEvaluated : Integer default 0;
  paymentsMatched   : Integer default 0;
  paymentsReview    : Integer default 0;
  // AI usage (all LLM calls of this run)
  aiCalls           : Integer default 0;
  promptTokens      : Integer default 0;
  completionTokens  : Integer default 0;
  totalTokens       : Integer default 0;
  extractionTokens  : Integer default 0;
  matchingTokens    : Integer default 0;
  estimatedCost     : Decimal(10, 4) default 0;
  capacityUnits     : Decimal(10, 4) default 0;
  aiModel           : String(80);
  // Stage timings
  erpSyncMs         : Integer default 0;
  mailIntakeMs      : Integer default 0;
  extractionMs      : Integer default 0;
  matchingMs        : Integer default 0;
}
