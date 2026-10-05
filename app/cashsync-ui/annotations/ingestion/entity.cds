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
        Description    : { $Type: 'UI.DataField', Value: classificationDecision }
    }
);
