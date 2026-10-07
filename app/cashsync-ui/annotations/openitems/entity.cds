using CashSyncService as service from '../../../../srv/cat-service';

// Open items are synced from S/4HANA (read-only); the AI assessment columns are written by Agent 3.
// Delete = soft delete (dismissed flag, see srv/cat-service.ts); S/4HANA itself is never changed.
annotate service.OpenItem with @(
    Capabilities : {
        DeleteRestrictions : { Deletable : true },
        InsertRestrictions : { Insertable : false },
        UpdateRestrictions : { Updatable : false }
    },
    UI.HeaderInfo : {
        TypeName       : '{i18n>openItemTypeName}',
        TypeNamePlural : '{i18n>openItemTypeNamePlural}',
        Title          : { $Type: 'UI.DataField', Value: OpenItemId },
        Description    : { $Type: 'UI.DataField', Value: CustomerName }
    },
    // Main LR tab: open S/4 items with the AI "is it paid?" assessment, most confident first.
    UI.SelectionPresentationVariant #OpenItems : {
        Text : '{i18n>tabOpenItems}',
        SelectionVariant : {
            SelectOptions : [
                {
                    PropertyName : ClearingStatus,
                    Ranges : [
                        { Sign : #I, Option : #EQ, Low : 'OPEN' }
                    ]
                }
            ]
        },
        PresentationVariant : {
            SortOrder : [
                { Property : aiConfidencePercent, Descending : true }
            ],
            Visualizations : [
                '@UI.LineItem'
            ]
        }
    },
    // Last LR tab: items already cleared (posted) in S/4HANA.
    UI.SelectionPresentationVariant #ClosedItems : {
        Text : '{i18n>tabClosedItems}',
        SelectionVariant : {
            SelectOptions : [
                {
                    PropertyName : ClearingStatus,
                    Ranges : [
                        { Sign : #I, Option : #EQ, Low : 'CLEARED' }
                    ]
                }
            ]
        },
        PresentationVariant : {
            SortOrder : [
                { Property : PostingDate, Descending : true }
            ],
            Visualizations : [
                '@UI.LineItem#Closed'
            ]
        }
    }
);
