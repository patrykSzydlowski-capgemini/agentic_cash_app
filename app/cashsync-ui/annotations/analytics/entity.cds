using CashSyncService as service from '../../../../srv/cat-service';

// "AI Agent Performance" tab: one row per 3-agent pipeline run (read-only).
annotate service.PipelineRuns with @(
    Capabilities.DeleteRestrictions : { Deletable : false },
    Capabilities.InsertRestrictions : { Insertable : false },
    Capabilities.UpdateRestrictions : { Updatable : false },
    UI.HeaderInfo : {
        TypeName       : '{i18n>pipelineRunTypeName}',
        TypeNamePlural : '{i18n>pipelineRunTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: trigger },
        Description    : { $Type: 'UI.DataField', Value: startedAt }
    },
    UI.SelectionPresentationVariant #PipelineRuns : {
        Text : '{i18n>tabAiAnalytics}',
        SelectionVariant : {
            SelectOptions : []
        },
        PresentationVariant : {
            SortOrder : [
                { Property : startedAt, Descending : true }
            ],
            Visualizations : [
                '@UI.LineItem'
            ]
        }
    },
    UI.SelectionFields : [
        trigger,
        status
    ]
);
