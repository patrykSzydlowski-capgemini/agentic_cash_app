using CashSyncService as service from '../../../../srv/cat-service';

annotate service.Payments with @(
    Capabilities.DeleteRestrictions : { Deletable : true },
    Capabilities.InsertRestrictions : { Insertable : false },
    Capabilities.UpdateRestrictions : { Updatable : false },
    UI.HeaderInfo : {
        TypeName       : '{i18n>paymentTypeName}',
        TypeNamePlural : '{i18n>paymentTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: payer },
        Description    : { $Type: 'UI.DataField', Value: status }
    },
    UI.SelectionPresentationVariant #AllPayments : {
        Text : '{i18n>tabAllPayments}',
        SelectionVariant : {
            SelectOptions : []
        },
        PresentationVariant : {
            Visualizations : [
                '@UI.LineItem'
            ]
        }
    }
);

