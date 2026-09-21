using { poc.cash as my } from '../db/schema';
using { poc.cashapp as app } from '../db/payments';
// Remote SAP mock (srv/external/ZAC_OPENITEMS_MOC_O4) kept for reference only.
// Local-first: SQLite poc.cash.OpenItem is the source of truth.

service CashSyncService {

    entity OpenItem as projection on my.OpenItem;

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
        action triggerAIAgent() returns String;
    };

    entity RemittanceItem as projection on my.RemittanceItem;
    entity AgentRun       as projection on my.AgentRun;
    entity ManualTask     as projection on my.ManualTask;

    // Imported ts-agentic-poc workflow (extraction -> matching -> review).
    @readonly entity Payments as projection on app.Payments {
        *,
        case status
            when 'matched'     then 3
            when 'extracted'   then 2
            when 'needsReview' then 2
            when 'cleared'     then 3
            else 0
        end as StatusCriticality : Integer
    };
    @readonly entity ProposedMatches as projection on app.ProposedMatches {
        *,
        case reviewStatus
            when 'posted'   then 3
            when 'approved' then 2
            when 'pending'  then 2
            when 'rejected' then 1
            else 0
        end as ReviewCriticality : Integer
    } actions {
        action approveMatch() returns ProposedMatches;
        action rejectMatch() returns ProposedMatches;
    };
    @readonly entity IngestionLog    as projection on app.IngestionLog;

    // Open Items browser tab: live S/4 read when CASH_S4_ENABLED=true,
    // local-first SQLite fallback otherwise.
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
    action uploadPayment(fileName: String, fileContent: LargeBinary) returns Payments;

    // Local-first pipeline: extract -> match -> persist. No external calls
    // unless CASH_AI_ENABLED / CASH_S4_ENABLED are explicitly set.
    action processPaymentDocument(pdfBase64: LargeString) returns String;

    // One-click sample validation from the UI: runs the same AI pipeline over
    // the bundled fixture PDF and stores the verdict in Payments/ProposedMatches
    // plus MatchResult rows visible in the main list report.
    action validateSampleDocument() returns String;

    // Akcja wywołująca Gemini 1.5 Flash do analizy pozycji
    action analyzeWithGemini() returns String;

    action ingestAgentMatch(
        match_id: String,
        open_item_id: String,
        matched_amount: Decimal(15,2),
        confidence: Decimal(5,2),
        review_reason: String
    ) returns String;
}
