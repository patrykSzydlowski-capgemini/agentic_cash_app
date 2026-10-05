using CashSyncService as service from '../../../../srv/cat-service';

annotate service.OpenItem with @(
    UI.LineItem : [
        { Value: OpenItemId,      Label: '{i18n>fieldOpenItemId}',      ![@HTML5.CssDefaults]: {width: '11rem'} },
        { Value: CustomerAccount, Label: '{i18n>fieldCustomerAccount}', ![@HTML5.CssDefaults]: {width: '11rem'} },
        { Value: CustomerName,    Label: '{i18n>fieldCustomerName}',    ![@HTML5.CssDefaults]: {width: '16rem'} },
        { Value: InvoiceAmount,   Label: '{i18n>fieldInvoiceAmount}',   ![@HTML5.CssDefaults]: {width: '9rem'} },
        { Value: ClearingStatus,  Label: '{i18n>fieldClearingStatus}',  ![@HTML5.CssDefaults]: {width: '10rem'} }
    ]
);
