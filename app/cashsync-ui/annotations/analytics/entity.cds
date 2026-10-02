using CashSyncService as service from '../../../../srv/cat-service';

annotate service.AiAnalytics with @(
    Capabilities.DeleteRestrictions : { Deletable : false },
    Capabilities.InsertRestrictions : { Insertable : false },
    Capabilities.UpdateRestrictions : { Updatable : false },
    UI.HeaderInfo : {
        TypeName       : '{i18n>aiAnalyticsTypeName}',
        TypeNamePlural : '{i18n>aiAnalyticsTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: payer },
        Description    : { $Type: 'UI.DataField', Value: aiModel }
    },
    UI.SelectionPresentationVariant #AiStats : {
        Text : '{i18n>tabAiAnalytics}',
        SelectionVariant : {
            SelectOptions : []
        },
        PresentationVariant : {
            SortOrder : [
                { Property : createdAt, Descending : true }
            ],
            Visualizations : [
                '@UI.LineItem'
            ]
        }
    },
    UI.SelectionFields : [
        aiModel,
        status
    ]
);
