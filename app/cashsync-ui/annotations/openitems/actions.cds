using CashSyncService as service from '../../../../srv/cat-service';

// "Post": manual clearing of the selected open items (S/4HANA; local test items locally).
// Critical -> FE asks for confirmation; only OPEN items can be posted; the list is refreshed
// so posted items move from "Open Items" to "Closed Items".
annotate service.OpenItem actions {
    postOpenItem @(
        Common.IsActionCritical  : true,
        Core.OperationAvailable  : { $edmJson: { $Eq: [ { $Path: 'in/ClearingStatus' }, 'OPEN' ] } },
        Common.SideEffects       : {
            TargetProperties : [
                'in/ClearingStatus',
                'in/ClearingCriticality',
                'in/ConfidenceCriticality'
            ],
            TargetEntities   : [
                'in/proposedMatches',
                '/CashSyncService.EntityContainer/OpenItem',
                '/CashSyncService.EntityContainer/Payments'
            ]
        }
    );
};

annotate service.OpenItem with @(
    // Object page header button.
    UI.Identification : [
        { $Type: 'UI.DataFieldForAction', Action: 'CashSyncService.postOpenItem', Label: '{i18n>actionPostOpenItem}' }
    ]
);
