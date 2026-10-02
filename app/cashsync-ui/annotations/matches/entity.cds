using CashSyncService as service from '../../../../srv/cat-service';

annotate service.ProposedMatches with @(
    Capabilities.DeleteRestrictions : { Deletable : true },
    Capabilities.InsertRestrictions : { Insertable : false },
    Capabilities.UpdateRestrictions : { Updatable : false },
    UI.HeaderInfo : {
        TypeName       : '{i18n>matchTypeName}',
        TypeNamePlural : '{i18n>matchTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: openItemId },
        Description    : { $Type: 'UI.DataField', Value: reviewStatus }
    }
);
