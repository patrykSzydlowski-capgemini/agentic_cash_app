using CashSyncService as service from '../../../../srv/cat-service';

annotate service.OpenItem with @(
    UI.SelectionFields : [
        CustomerName,
        CompanyCode,
        aiMatchStatus,
        source
    ],
    // Open items tab: why the AI is (not) sure the item is paid.
    UI.LineItem : [
        // Toolbar button (bound, multi-select): each selected item is posted on its own.
        {
            $Type              : 'UI.DataFieldForAction',
            Action             : 'CashSyncService.postOpenItem',
            Label              : '{i18n>actionPostOpenItem}',
            InvocationGrouping : #Isolated
        },
        { $Type: 'UI.DataField', Value: OpenItemId,      Label: '{i18n>fieldOpenItemId}',      ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: CustomerName,    Label: '{i18n>fieldCustomerName}',    ![@HTML5.CssDefaults]: {width: '14rem'} },
        { $Type: 'UI.DataField', Value: CompanyCode,     Label: '{i18n>fieldCompanyCode}',     ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: InvoiceAmount,   Label: '{i18n>fieldInvoiceAmount}',   ![@HTML5.CssDefaults]: {width: '10rem'} },
        {
            $Type                 : 'UI.DataFieldForAnnotation',
            Target                : '@UI.DataPoint#AiConfidence',
            Label                 : '{i18n>fieldAiPaidConfidence}',
            ![@HTML5.CssDefaults] : {width: '11rem'}
        },
        {
            $Type                     : 'UI.DataField',
            Value                     : aiMatchStatus,
            Criticality               : ConfidenceCriticality,
            CriticalityRepresentation : #WithIcon,
            Label                     : '{i18n>fieldAiMatchStatus}',
            ![@HTML5.CssDefaults]     : {width: '13rem'}
        },
        { $Type: 'UI.DataField', Value: aiRationale,         Label: '{i18n>fieldAiRationale}',         ![@HTML5.CssDefaults]: {width: '32rem'} },
        { $Type: 'UI.DataField', Value: matchedPaymentCount, Label: '{i18n>fieldMatchedPaymentCount}', ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: matchedAmount,       Label: '{i18n>fieldMatchedAmount}',       ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: PostingDate,         Label: '{i18n>fieldPostingDate}',         ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: source,              Label: '{i18n>fieldOpenItemSource}',      ![@HTML5.CssDefaults]: {width: '8rem'} }
    ],
    // Closed items tab: cleared in S/4HANA (or locally for local test items).
    UI.LineItem #Closed : [
        { $Type: 'UI.DataField', Value: OpenItemId,      Label: '{i18n>fieldOpenItemId}',      ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: CustomerName,    Label: '{i18n>fieldCustomerName}',    ![@HTML5.CssDefaults]: {width: '14rem'} },
        { $Type: 'UI.DataField', Value: CustomerAccount, Label: '{i18n>fieldCustomerAccount}', ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: CompanyCode,     Label: '{i18n>fieldCompanyCode}',     ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: InvoiceAmount,   Label: '{i18n>fieldInvoiceAmount}',   ![@HTML5.CssDefaults]: {width: '10rem'} },
        {
            $Type                     : 'UI.DataField',
            Value                     : ClearingStatus,
            Criticality               : ClearingCriticality,
            CriticalityRepresentation : #WithIcon,
            Label                     : '{i18n>fieldClearingStatus}',
            ![@HTML5.CssDefaults]     : {width: '10rem'}
        },
        { $Type: 'UI.DataField', Value: PostingDate,         Label: '{i18n>fieldPostingDate}',         ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: DocumentDate,        Label: '{i18n>fieldDocumentDate}',        ![@HTML5.CssDefaults]: {width: '9rem'} },
        { $Type: 'UI.DataField', Value: matchedPaymentCount, Label: '{i18n>fieldMatchedPaymentCount}', ![@HTML5.CssDefaults]: {width: '7rem'} },
        { $Type: 'UI.DataField', Value: aiRationale,         Label: '{i18n>fieldAiRationale}',         ![@HTML5.CssDefaults]: {width: '28rem'} },
        { $Type: 'UI.DataField', Value: source,              Label: '{i18n>fieldOpenItemSource}',      ![@HTML5.CssDefaults]: {width: '8rem'} }
    ]
);
