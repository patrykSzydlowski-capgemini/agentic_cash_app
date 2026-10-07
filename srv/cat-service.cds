using { poc.cash as my } from '../db/schema';
using { poc.cashapp as app } from '../db/payments';
// Remote SAP mock (srv/external/ZAC_OPENITEMS_MOC_O4) kept for reference only.
// Local-first: SQLite poc.cash.OpenItem is the source of truth.

service CashSyncService {

    // Local-first cache of S/4HANA open items (open + cleared), synced at startup / revalidation.
    // AI assessment fields are written by Agent 3 of the pipeline only.
    @readonly
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
        end as ClearingCriticality : Integer
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

    @readonly entity AiAnalytics     as projection on app.Payments {
        ID,
        createdAt,
        modifiedAt,
        payer,
        amount,
        currency,
        valueDate,
        status,
        extractionConfidence,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost,
        capacityUnits,
        aiModel,
        processingTimeMs,
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
    };

    type AiStatisticsRecord {
        totalPromptTokens        : Integer;
        totalCompletionTokens    : Integer;
        totalTokens              : Integer;
        totalCost                : Decimal(10, 4);
        totalCapacityUnits       : Decimal(10, 4);
        totalProcessed           : Integer;
        // Mean / Average metrics
        avgProcessingTimeMs      : Integer;
        avgTokensPerPayment      : Integer;
        avgPromptTokens          : Integer;
        avgCompletionTokens      : Integer;
        avgCost                  : Decimal(10, 4);
        avgCapacityUnits         : Decimal(10, 4);
        // Median metrics
        medianProcessingTimeMs   : Integer;
        medianTokensPerPayment   : Integer;
        medianPromptTokens       : Integer;
        medianCompletionTokens   : Integer;
        medianCost               : Decimal(10, 4);
        medianCapacityUnits      : Decimal(10, 4);
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
            AiAnalytics
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
            AiAnalytics
        ]
    }
    action syncMailbox() returns array of IngestionLog;

    // Full pipeline run: sync S/4 OpenItems -> Agent 1 -> Agent 2 (incl. failed mails) -> Agent 3 for all unposted payments
    @Common.SideEffects: {
        TargetEntities: [
            Payments,
            ProposedMatches,
            IngestionLog,
            OpenItem,
            MatchResult,
            AiAnalytics
        ]
    }
    action revalidatePipeline() returns String;

    action ingestAgentMatch(
        match_id: String,
        open_item_id: String,
        matched_amount: Decimal(15,2),
        confidence: Decimal(5,2),
        review_reason: String
    ) returns String;
}
