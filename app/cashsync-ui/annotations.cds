using CashSyncService as service from '../../srv/cat-service';

annotate service.Payments with @(
    UI.HeaderInfo : {
        TypeName       : 'Płatność',
        TypeNamePlural : 'Kolejka Dopasowań',
        Title          : { $Type: 'UI.DataField', Value: payer },
        Description    : { $Type: 'UI.DataField', Value: status }
    },
    // Matching queue (reference tab 3): filter by AI outcome / review state.
    UI.SelectionFields : [
        status
    ],
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: payer,                Label: 'Płatnik' },
        { $Type: 'UI.DataField', Value: amount,               Label: 'Kwota' },
        { $Type: 'UI.DataField', Value: currency,             Label: 'Waluta' },
        { $Type: 'UI.DataField', Value: valueDate,            Label: 'Data' },
        { $Type: 'UI.DataField', Value: extractionConfidence, Label: 'Pewność AI' },
        { $Type: 'UI.DataField', Value: status,               Criticality: StatusCriticality, Label: 'Status' }
    ],
    UI.FieldGroup #PaymentDetails : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: payer,                Label: 'Płatnik' },
            { $Type: 'UI.DataField', Value: amount,               Label: 'Kwota' },
            { $Type: 'UI.DataField', Value: currency,             Label: 'Waluta' },
            { $Type: 'UI.DataField', Value: valueDate,            Label: 'Data Waluty' },
            { $Type: 'UI.DataField', Value: extractionConfidence, Label: 'Pewność AI' },
            { $Type: 'UI.DataField', Value: status,               Label: 'Status' }
        ]
    },
    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'PaymentDetailsFacet',
            Label  : 'Szczegóły Płatności',
            Target : '@UI.FieldGroup#PaymentDetails'
        },
        // FE-native tabs on the Payments Object Page anchor bar: each
        // association renders as a tab with its own LineItem table, no
        // custom navigation buttons needed (skill fiori-elements level 1).
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'MatchesFacet',
            Label  : 'Proponowane Dopasowania',
            Target : 'matches/@UI.LineItem'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'IngestionFacet',
            Label  : 'Dziennik Pobierania',
            Target : 'ingestion/@UI.LineItem#ingestion'
        }
    ]
);

annotate service.ProposedMatches with @(
    UI.HeaderInfo : {
        TypeName       : 'Dopasowanie',
        TypeNamePlural : 'Proponowane Dopasowania',
        Title          : { $Type: 'UI.DataField', Value: openItemId },
        Description    : { $Type: 'UI.DataField', Value: reviewStatus }
    },
    // Outcome panel (reference posted/postingError/rejected view): posting
    // result fields shown with review criticality.
    UI.FieldGroup #PostingOutcome : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: reviewStatus,   Criticality: ReviewCriticality, Label: 'Wynik Przeglądu' },
            { $Type: 'UI.DataField', Value: postingId,      Label: 'ID Księgowania' },
            { $Type: 'UI.DataField', Value: documentNumber, Label: 'Nr Dokumentu' },
            { $Type: 'UI.DataField', Value: postingError,   Label: 'Błąd Księgowania' }
        ]
    },
    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'PostingOutcomeFacet',
            Label  : 'Wynik Księgowania',
            Target : '@UI.FieldGroup#PostingOutcome'
        }
    ],
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: openItemId,   Label: 'ID Pozycji SAP' },
        { $Type: 'UI.DataField', Value: companyCode,  Label: 'Kod Firmy' },
        { $Type: 'UI.DataField', Value: customerAccount, Label: 'Konto Klienta' },
        { $Type: 'UI.DataField', Value: amount,       Label: 'Kwota' },
        { $Type: 'UI.DataField', Value: currency,     Label: 'Waluta' },
        { $Type: 'UI.DataField', Value: matchStatus,  Label: 'Status Dopasowania' },
        { $Type: 'UI.DataField', Value: matchScore,   Label: 'Wynik' },
        { $Type: 'UI.DataField', Value: reviewStatus, Criticality: ReviewCriticality, Label: 'Przegląd' },
        { $Type: 'UI.DataField', Value: rationale,    Label: 'Analiza AI' },
        // Per-row review actions (reference per-row Approve/Reject on pending).
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.approveMatch',
            Label  : 'Zatwierdź'
        },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.rejectMatch',
            Label  : 'Odrzuć'
        }
    ]
);

annotate service.IngestionLog with @(
    UI.HeaderInfo : {
        TypeName       : 'Wpis Dziennika',
        TypeNamePlural : 'Dziennik Pobierania',
        Title          : { $Type: 'UI.DataField', Value: filename },
        Description    : { $Type: 'UI.DataField', Value: classificationDecision }
    },
    UI.SelectionFields : [
        source,
        classificationDecision
    ],
    UI.LineItem : [
        { Value: timestamp,              Label: 'Czas' },
        { Value: source,                 Label: 'Źródło' },
        { Value: subject,                Label: 'Temat' },
        { Value: filename,               Label: 'Plik' },
        { Value: classificationDecision, Label: 'Decyzja' }
    ],
    // Rendered inside the Payments Object Page 'Dziennik Pobierania' tab
    // (UI.ReferenceFacet Target 'ingestion/@UI.LineItem').
    UI.LineItem #ingestion : [
        { Value: timestamp,              Label: 'Czas' },
        { Value: source,                 Label: 'Źródło' },
        { Value: subject,                Label: 'Temat' },
        { Value: filename,               Label: 'Plik' },
        { Value: classificationDecision, Label: 'Decyzja' }
    ]
);

annotate service.OpenItem with @(
    UI.LineItem : [
        { Value: OpenItemId,      Label: 'ID Pozycji' },
        { Value: CustomerAccount, Label: 'Konto Klienta' },
        { Value: CustomerName,    Label: 'Nazwa Klienta' },
        { Value: InvoiceAmount,   Label: 'Kwota' },
        { Value: ClearingStatus,  Label: 'Status' }
    ]
);

// MatchResult list: review-action buttons restored with multi-selection support.
annotate service.MatchResult with @(
    UI.HeaderInfo : {
        TypeName       : 'Dopasowanie',
        TypeNamePlural : 'Dopasowania Płatności',
        Title          : { $Type: 'UI.DataField', Value: match_id }
    },
    UI.SelectionFields : [
        match_status,
        review_status,
        action_required
    ],
    UI.LineItem : [
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.analyzeWithGemini',
            Label  : 'Uruchom Analizę AI'
        },
        { $Type: 'UI.DataField', Value: match_id,                Label: 'ID Dopasowania' },
        { $Type: 'UI.DataField', Value: open_item.OpenItemId,    Label: 'ID Pozycji SAP' },
        { $Type: 'UI.DataField', Value: open_item.CustomerName,  Label: 'Klient' },
        { $Type: 'UI.DataField', Value: matched_amount,          Label: 'Dopasowana Kwota' },
        { $Type: 'UI.DataField', Value: confidence,              Label: 'Pewność AI' },
        { $Type: 'UI.DataField', Value: match_status,            Criticality: CriticalityCode, Label: 'Status' },
        { $Type: 'UI.DataField', Value: review_reason,           Label: 'Analiza Gemini AI' },
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'CashSyncService.triggerAIAgent',
            Label  : 'Zatwierdź Ręcznie'
        }
    ]
);

annotate service.MatchResult actions {
    triggerAIAgent @(
        Common.SideEffects : {
            TargetProperties : [
                'match_status',
                'action_required',
                'review_status',
                'review_reason',
                'CriticalityCode'
            ]
        }
    );
};
