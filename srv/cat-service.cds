using { poc.cash as my } from '../db/schema';
using { poc.cashapp as app } from '../db/payments';
// Remote SAP mock (srv/external/ZAC_OPENITEMS_MOC_O4) kept for reference only.
// Local-first: SQLite poc.cash.OpenItem is the source of truth.

service CashSyncService {

    // Local-first cache of S/4HANA open items (open + cleared), synced at startup / revalidation.
    // AI assessment fields are written by Agent 3 of the pipeline only.
    // Only DELETE is accepted (soft delete -> dismissed = true, see cat-service.ts);
    // CREATE/UPDATE are rejected because S/4HANA is the source of truth.
    // postOpenItem = manual clearing by the operator (S/4HANA; local test items locally).
    entity OpenItem as projection on my.OpenItem {
        *,
        case
            when ClearingStatus = 'CLEARED' then 5
            when aiConfidence >= 0.85 then 3
            when aiConfidence >= 0.40 then 2
            else 1
        end as ConfidenceCriticality : Integer,
        case ClearingStatus
            when 'CLEARED' then 5
            when 'OPEN'    then 2
            else 0
        end as ClearingCriticality : Integer,
        // Confidence as 0..100 for the progress bar (null -> 0, never "of 1").
        cast(coalesce(aiConfidence, 0) * 100 as Integer) as aiConfidencePercent : Integer,
        // Localized enum title of `source` (S/4HANA vs. local test item), filled by an after-READ handler.
        virtual sourceText : String
    } where dismissed is null or dismissed = false
      actions {
        action postOpenItem() returns OpenItem;
    };

    @cds.odata.expand: [ 'open_item' ]
    entity MatchResult as projection on my.MatchResult {
        *,
        open_item,
        case match_status
            when 'MATCHED'      then 3
            when 'NEEDS_REVIEW' then 2
            when 'REJECTED'     then 1
            else 0
        end as CriticalityCode : Integer
    } actions {
        action triggerAIAgent() returns MatchResult;
        action manualApprove()  returns MatchResult;
    };

    entity ManualTask     as projection on my.ManualTask;

    // Imported ts-agentic-poc workflow (extraction -> matching -> review).
    @cds.redirection.target
    entity Payments as projection on app.Payments {
        *,
        case status
            when 'posted'      then 5
            when 'cleared'     then 5
            when 'matched'     then 3
            when 'extracted'   then 2
            when 'needsReview' then 2
            else 0
        end as StatusCriticality : Integer,
        case status
            when 'matched'     then 'Matched'
            when 'needsReview' then 'Pending Review'
            when 'cleared'     then 'Posted'
            when 'posted'      then 'Posted'
            when 'extracted'   then 'Extracted'
            when 'failed'      then 'Failed'
            else status
        end as statusText : String,
        case
            when status = 'posted' or status = 'cleared' then 5
            when extractionConfidence >= 0.80 then 3
            else 2
        end as ConfidenceCriticality : Integer
    } actions {
        action reprocessWithAI() returns Payments;
        action postToS4()         returns Payments;
    };
    entity ProposedMatches as projection on app.ProposedMatches {
        *,
        case reviewStatus
            when 'posted'   then 5
            when 'approved' then 3
            when 'pending'  then 2
            when 'rejected' then 1
            else 0
        end as ReviewCriticality : Integer
    } actions {
        action approveMatch() returns ProposedMatches;
        action rejectMatch() returns ProposedMatches;
    };
    @readonly entity IngestionLog    as projection on app.IngestionLog {
        *,
        case processingStatus
            when 'extracted' then 3
            when 'received'  then 2
            when 'failed'    then 1
            else 0
        end as ProcessingCriticality : Integer,
        case classificationDecision
            when 'relevant'    then 3
            when 'needsReview' then 2
            when 'notRelevant' then 1
            else 0
        end as DecisionCriticality : Integer
    };

    // "AI Agent Performance" tab: one row per pipeline run.
    @readonly entity PipelineRuns    as projection on app.PipelineRuns {
        *,
        case status
            when 'completed' then 3
            when 'running'   then 2
            when 'failed'    then 1
            else 0
        end as StatusCriticality : Integer,
        // Localized enum titles, filled by an after-READ handler (cds.i18n.labels).
        virtual triggerText      : String,
        virtual statusText       : String
    };

    // KPI dialog: aggregates over all finished pipeline runs.
    type AiStatisticsRecord {
        totalRuns                : Integer;
        failedRuns               : Integer;
        totalPromptTokens        : Integer;
        totalCompletionTokens    : Integer;
        totalTokens              : Integer;
        totalCost                : Decimal(10, 4);
        totalCapacityUnits       : Decimal(10, 4);
        totalAiCalls             : Integer;
        totalFilesExtracted      : Integer;
        totalPaymentsEvaluated   : Integer;
        totalPaymentsMatched     : Integer;
        // Per-run averages / medians
        avgDurationMs            : Integer;
        avgTokensPerRun          : Integer;
        avgCostPerRun            : Decimal(10, 4);
        medianDurationMs         : Integer;
        medianTokensPerRun       : Integer;
        // Per processed file
        avgTokensPerFile         : Integer;
        // Last finished run
        lastRunAt                : Timestamp;
        lastRunDurationMs        : Integer;
        lastRunTokens            : Integer;
        lastRunOpenItems         : Integer;
        activeModel              : String(80);
    };

    function getAiStatistics() returns AiStatisticsRecord;

    // Open Items browser tab: live S/4 read with local-first SQLite fallback.
    function getOpenItems(customerAccount: String) returns array of OpenItemRecord;

    type OpenItemRecord {
        openItemId            : String(36);
        postingDate           : String;
        documentDate          : String;
        companyCode           : String(4);
        customerAccount       : String(10);
        customerName          : String(140);
        invoiceAmountCurrency : String(3);
        invoiceAmount         : Decimal(15, 2);
        clearingStatus        : String(20);
    };

    // UI-facing upload entry point: raw PDF bytes (Buffer or base64 string).
    @Common.SideEffects: {
        TargetEntities: [
            Payments,
            ProposedMatches,
            OpenItem,
            MatchResult,
            PipelineRuns
        ]
    }
    action uploadPayment(fileName: String, fileContent: LargeBinary) returns Payments;

    // AI & S/4 pipeline: extract -> match -> persist.
    action processPaymentDocument(pdfBase64: LargeString) returns String;


    // Incremental pipeline run: Agent 1 downloads new PDF mails -> Agent 2 extracts -> Agent 3 matches + assesses open items
    @Common.SideEffects: {
        TargetEntities: [
            Payments,
            ProposedMatches,
            IngestionLog,
            OpenItem,
            MatchResult,
            PipelineRuns
        ]
    }
    action syncMailbox() returns array of IngestionLog;

    // Live progress of the running (or last finished) pipeline run.
    type PipelineProgress {
        runId         : UUID;
        trigger       : String(20);
        scope         : String(20);  // all | openItems | payments
        selectedCount : Integer;
        status        : String(20);  // idle | running | completed | failed
        phase         : String(20);  // erpSync | mailIntake | extraction | matching | assessment | done
        phaseIndex    : Integer;
        phaseCount    : Integer;
        processed     : Integer;
        total         : Integer;
        percent       : Integer;
        startedAt     : Timestamp;
        finishedAt    : Timestamp;
        message       : String;
        openItems     : Integer;
        extracted     : Integer;
        failed        : Integer;
        evaluated     : Integer;
        matched       : Integer;
        review        : Integer;
    };

    // "Revalidate Items": starts the pipeline in the background and returns its progress at once
    // (a synchronous run outlives the approuter timeout -> 502); the UI polls getPipelineProgress
    // and refreshes the tables when the run has finished.
    // No ids: full run (S/4 OpenItems -> Agent 1 -> Agent 2 incl. failed mails -> Agent 3 for all unposted payments).
    // openItemIds: only payments linked to these open items; paymentIds: only these payments.
    action revalidatePipeline(openItemIds : many String, paymentIds : many UUID) returns PipelineProgress;

    function getPipelineProgress() returns PipelineProgress;

    action ingestAgentMatch(
        match_id: String,
        open_item_id: String,
        matched_amount: Decimal(15,2),
        confidence: Decimal(5,2),
        review_reason: String
    ) returns String;
}
