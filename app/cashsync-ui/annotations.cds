using CashSyncService as service from '../../srv/cat-service';

annotate service.MatchResult with {
    match_id        @title : 'ID Dopasowania';
    matched_amount  @title : 'Kwota Dopasowana'  @Measures.ISOCurrency : open_item.InvoiceAmountCurr;
    match_status    @title : 'Status Dopasowania';
    source_label    @title : 'Źródło Dopasowania';
    action_required @title : 'Wymaga Akcji';
};

annotate service.MatchResult with @(
    UI.HeaderInfo : {
       TypeName : 'Dopasowanie',
        TypeNamePlural : 'Dopasowania Płatności AI',
        Title : { $Type : 'UI.DataField', Value : match_id },
        Description : { $Type : 'UI.DataField', Value : open_item.CustomerName }
    },

    // Pasek filtrów na stronie głównej
    UI.SelectionFields : [
        match_status,
        action_required,
        source_label
    ],

    // Kolumny w tabeli List Report
    UI.LineItem : [
        {
            $Type : 'UI.DataFieldForAction',
            Action : 'CashSyncService.triggerAIAgent',
            Label : 'Uruchom Agenta AI'
        },
        {
            $Type : 'UI.DataField',
            Value : match_id,
            Label : 'ID Dopasowania'
        },
        {
            $Type : 'UI.DataField',
            Value : open_item.CustomerName,
            Label : 'Klient (S/4HANA)'
        },
        {
            $Type : 'UI.DataField',
            Value : matched_amount,
            Label : 'Kwota'
        },
        {
            $Type : 'UI.DataField',
            Value : match_status,
            Label : 'Status',
            Criticality : CriticalityCode
        },
        {
            $Type : 'UI.DataField',
            Value : source_label,
            Label : 'Źródło'
        },
        {
            $Type : 'UI.DataField',
            Value : action_required,
            Label : 'Wymaga Akcji'
        }
    ],

    // KONFIGURACJA OBJECT PAGE (Widok po kliknięciu w rekord)
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'MainFacet',
            Label : 'Szczegóły Dopasowania',
            Target : '@UI.FieldGroup#Details'
        }
    ],

    UI.FieldGroup #Details : {
        Data : [
            { $Type : 'UI.DataField', Value : match_id },
            { $Type : 'UI.DataField', Value : open_item.CustomerName, Label : 'Klient' },
            { $Type : 'UI.DataField', Value : matched_amount },
            { $Type : 'UI.DataField', Value : match_status, Criticality : CriticalityCode },
            { $Type : 'UI.DataField', Value : source_label },
            { $Type : 'UI.DataField', Value : action_required }
        ]
    }
);
