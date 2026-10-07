using CashSyncService as service from '../../../../srv/cat-service';

annotate service.ProposedMatches with @(
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: openItemId,        Label: '{i18n>fieldOpenItemId}',        ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: companyCode,       Label: '{i18n>fieldCompanyCode}',       ![@HTML5.CssDefaults]: {width: '8rem'} },
        { $Type: 'UI.DataField', Value: customerAccount,   Label: '{i18n>fieldCustomerAccount}',   ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: amount,            Label: '{i18n>fieldAmount}',            ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: matchStatus,       Label: '{i18n>fieldMatchStatus}',       ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataFieldForAnnotation', Target: '@UI.DataPoint#MatchScoreProgress', Label: '{i18n>fieldMatchScore}', ![@HTML5.CssDefaults]: {width: '10rem'} },
        { $Type: 'UI.DataField', Value: reviewStatus,      Criticality: ReviewCriticality, Label: '{i18n>fieldReviewStatus}', ![@HTML5.CssDefaults]: {width: '11rem'} },
        { $Type: 'UI.DataField', Value: rationale,         Label: '{i18n>fieldRationale}',         ![@HTML5.CssDefaults]: {width: '22rem'} }
    ]
);
