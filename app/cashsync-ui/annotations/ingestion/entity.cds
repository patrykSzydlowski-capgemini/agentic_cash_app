using CashSyncService as service from '../../../../srv/cat-service';

annotate service.IngestionLog with @(
    Capabilities : {
        DeleteRestrictions : { Deletable : false },
        InsertRestrictions : { Insertable : false },
        UpdateRestrictions : { Updatable : false }
    },
    UI.HeaderInfo : {
        TypeName       : '{i18n>ingestionTypeName}',
        TypeNamePlural : '{i18n>ingestionTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: filename },
        Description    : { $Type: 'UI.DataField', Value: subject }
    },
    // LR tab "All mails": every remittance mail Agent 1 stored (newest first).
    UI.SelectionPresentationVariant #Mails : {
        Text : '{i18n>tabMails}',
        SelectionVariant : {
            SelectOptions : []
        },
        PresentationVariant : {
            SortOrder : [
                { Property : timestamp, Descending : true }
            ],
            Visualizations : [
                '@UI.LineItem'
            ]
        }
    }
);
