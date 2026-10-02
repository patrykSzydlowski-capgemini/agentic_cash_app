using CashSyncService as service from '../../../../srv/cat-service';

annotate service.MatchResult actions {
    triggerAIAgent @(
        Common.SideEffects : {
            TargetProperties : [
                'confidence',
                'match_status',
                'action_required',
                'review_status',
                'review_reason',
                'CriticalityCode'
            ]
        }
    );
    manualApprove @(
        Common.SideEffects : {
            TargetProperties : [
                'match_status',
                'action_required',
                'review_status',
                'review_reason',
                'CriticalityCode'
            ]
        }
    );
};
