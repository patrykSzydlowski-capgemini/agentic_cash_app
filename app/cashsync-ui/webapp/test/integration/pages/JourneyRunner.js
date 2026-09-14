sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"poc/cash/cashsyncui/test/integration/pages/MatchResultList.gen",
	"poc/cash/cashsyncui/test/integration/pages/MatchResultObjectPage.gen"
], function (JourneyRunner, MatchResultListGenerated, MatchResultObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('poc/cash/cashsyncui') + '/test/flp.html#app-preview',
        pages: {
			onTheMatchResultListGenerated: MatchResultListGenerated,
			onTheMatchResultObjectPageGenerated: MatchResultObjectPageGenerated
        },
        async: true
    });

    return runner;
});

