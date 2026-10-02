using CashSyncService as service from '../../../../srv/cat-service';

annotate service.ProposedMatches with @(
    // Outcome panel: posting result fields shown with review criticality.
    UI.FieldGroup #PostingOutcome : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: reviewStatus,   Criticality: ReviewCriticality, Label: '{i18n>fieldReviewStatus}' },
            { $Type: 'UI.DataField', Value: postingId,      Label: '{i18n>fieldPostingId}' },
            { $Type: 'UI.DataField', Value: documentNumber, Label: '{i18n>fieldDocumentNumber}' },
            { $Type: 'UI.DataField', Value: postingError,   Label: '{i18n>fieldPostingError}' }
        ]
    },
    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'PostingOutcomeFacet',
            Label  : '{i18n>facetPostingOutcome}',
            Target : '@UI.FieldGroup#PostingOutcome'
        }
    ]
);

annotate service.ProposedMatches actions {
    approveMatch @(
        Common.SideEffects : {
            TargetProperties : [
                'reviewStatus',
                'ReviewCriticality',
                'postingId',
                'documentNumber',
                'postingError'
            ],
            TargetEntities : [
                'payment'
            ]
        }
    );
    rejectMatch @(
        Common.SideEffects : {
            TargetProperties : [
                'reviewStatus',
                'ReviewCriticality'
            ],
            TargetEntities : [
                'payment'
            ]
        }
    );
};
