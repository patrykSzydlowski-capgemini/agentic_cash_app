using CashSyncService as service from '../../../../srv/cat-service';

annotate service.MatchResult with {
    match_id        @title: '{i18n>fieldMatchId}';
    matched_amount  @title: '{i18n>fieldMatchedAmount}';
    variance_amount @title: '{i18n>fieldVarianceAmount}';
    confidence      @title: '{i18n>fieldExtractionConfidence}';
    review_reason   @title: '{i18n>fieldReviewReason}';
    source_label    @title: '{i18n>fieldSource}';
    action_required @title: '{i18n>fieldStatus}';
    review_status   @title: '{i18n>fieldReviewStatus}';
    match_status    @title: '{i18n>fieldMatchStatus}';
};
