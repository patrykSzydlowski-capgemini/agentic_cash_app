sap.ui.define([
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/Component",
    "sap/ui/core/ElementRegistry"
], function (Fragment, JSONModel, MessageToast, MessageBox, Component, ElementRegistry) {
    "use strict";

    var _pDialog = null;
    var _oDialogInstance = null;
    var _oKpiModel = new JSONModel();

    function formatNumber(n) {
        return (n || 0).toLocaleString("en-US");
    }

    async function loadStatistics(oModel) {
        try {
            var sUrl = "/odata/v4/cash-sync/getAiStatistics()";
            var response = await fetch(sUrl, {
                headers: {
                    "Accept": "application/json"
                }
            });
            if (!response.ok) {
                throw new Error("HTTP " + response.status + ": " + response.statusText);
            }
            var data = await response.json();
            var stats = data.value || data;

            var totalCost = Number(stats.totalCost || 0);
            var totalCU = Number(stats.totalCapacityUnits || 0);
            var avgCost = Number(stats.avgCostPerRun || 0);
            var avgDurationMs = stats.avgDurationMs || 0;
            var medianDurationMs = stats.medianDurationMs || 0;
            var lastRunDurationMs = stats.lastRunDurationMs || 0;

            // All figures are aggregated over finished pipeline runs (PipelineRuns).
            _oKpiModel.setData({
                totalRunsFormatted: formatNumber(stats.totalRuns),
                failedRunsFormatted: formatNumber(stats.failedRuns),
                totalTokensFormatted: formatNumber(stats.totalTokens),
                totalPromptTokensFormatted: formatNumber(stats.totalPromptTokens),
                totalCompletionTokensFormatted: formatNumber(stats.totalCompletionTokens),
                totalCostFormattedWithCurrency: "$" + totalCost.toFixed(4),
                totalCapacityUnitsFormatted: totalCU.toFixed(4),
                totalAiCallsFormatted: formatNumber(stats.totalAiCalls),
                totalFilesExtractedFormatted: formatNumber(stats.totalFilesExtracted),
                totalPaymentsEvaluatedFormatted: formatNumber(stats.totalPaymentsEvaluated),
                totalPaymentsMatchedFormatted: formatNumber(stats.totalPaymentsMatched),

                avgDurationSec: (avgDurationMs / 1000).toFixed(1),
                avgTokensPerRunFormatted: formatNumber(stats.avgTokensPerRun),
                avgCostFormattedWithCurrency: "$" + avgCost.toFixed(4),
                avgTokensPerFileFormatted: formatNumber(stats.avgTokensPerFile),

                medianDurationSec: (medianDurationMs / 1000).toFixed(1),
                medianTokensPerRunFormatted: formatNumber(stats.medianTokensPerRun),

                lastRunAt: stats.lastRunAt ? new Date(stats.lastRunAt).toLocaleString() : "—",
                lastRunDurationMsFormatted: formatNumber(lastRunDurationMs),
                lastRunTokensFormatted: formatNumber(stats.lastRunTokens),
                lastRunOpenItemsFormatted: formatNumber(stats.lastRunOpenItems),

                activeModel: stats.activeModel || "gemini-2.5-flash"
            });
        } catch (err) {
            MessageBox.error(getText("errorFetchingAiStats", [err.message], "Failed to retrieve AI statistics: " + err.message));
        }
    }

    function getText(sKey, aArgs, sFallback) {
        try {
            var oI18n = findI18nModel();
            if (oI18n && typeof oI18n.getResourceBundle === "function") {
                var oBundle = oI18n.getResourceBundle();
                if (oBundle && typeof oBundle.getText === "function") {
                    return oBundle.getText(sKey, aArgs);
                }
            }
        } catch (e) {
            // fallback
        }
        var sRes = sFallback || sKey;
        if (Array.isArray(aArgs)) {
            aArgs.forEach(function (arg, idx) {
                sRes = sRes.replace("{" + idx + "}", arg);
            });
        }
        return sRes;
    }
    function getComponentInstance(sId) {
        if (Component && typeof Component.getComponentById === 'function') {
            return Component.getComponentById(sId);
        }
        return null;
    }

    function getAllElements() {
        if (ElementRegistry && typeof ElementRegistry.all === 'function') {
            return ElementRegistry.all();
        }
        return {};
    }

    function findModel(oThis, oContext) {
        if (oContext && typeof oContext.getModel === 'function') {
            return oContext.getModel();
        }
        if (oThis) {
            if (typeof oThis.getModel === 'function') return oThis.getModel();
            if (typeof oThis.getView === 'function') {
                var v = oThis.getView();
                if (v && typeof v.getModel === 'function') return v.getModel();
            }
            if (oThis.base && typeof oThis.base.getModel === 'function') return oThis.base.getModel();
        }
        var aCompNames = ['container', 'poc.cash.cashsyncui'];
        for (var i = 0; i < aCompNames.length; i++) {
            var comp = getComponentInstance(aCompNames[i]);
            if (comp && typeof comp.getModel === 'function') return comp.getModel();
        }
        var aAll = getAllElements();
        for (var sId in aAll) {
            var oEl = aAll[sId];
            if (oEl && typeof oEl.getModel === 'function') {
                var m = oEl.getModel();
                if (m && typeof m.bindContext === 'function') return m;
            }
        }
        return null;
    }

    function findI18nModel() {
        var aCompNames = ['container', 'poc.cash.cashsyncui'];
        for (var i = 0; i < aCompNames.length; i++) {
            var comp = getComponentInstance(aCompNames[i]);
            if (comp && typeof comp.getModel === 'function') {
                var i18n = comp.getModel('i18n');
                if (i18n) return i18n;
            }
        }
        var aAll = getAllElements();
        for (var sId in aAll) {
            var oEl = aAll[sId];
            if (oEl && typeof oEl.getModel === 'function') {
                var i18n = oEl.getModel('i18n');
                if (i18n) return i18n;
            }
        }
        return null;
    }

    var oDashboardController = {
        onShowKpis: function (oContext, aSelectedContexts) {
            var oModel = findModel(this, oContext);
            var oI18n = findI18nModel();

            if (!_pDialog) {
                _pDialog = Fragment.load({
                    name: "poc.cash.cashsyncui.ext.AiKpiDialog",
                    controller: oDashboardController
                }).then(function (oDialog) {
                    _oDialogInstance = oDialog;
                    _oDialogInstance.setModel(_oKpiModel, "kpi");
                    if (oI18n) {
                        _oDialogInstance.setModel(oI18n, "i18n");
                    }
                    if (oModel) {
                        _oDialogInstance.setModel(oModel);
                    }
                    return _oDialogInstance;
                });
            }

            _pDialog.then(function (oDialog) {
                loadStatistics();
                oDialog.open();
            });
        },

        onRefreshStats: function (oContext, aSelectedContexts) {
            MessageToast.show(getText("toastRefreshingStats", null, "Refreshing AI statistics and table..."));
            loadStatistics();
            var oModel = findModel(this, oContext);
            if (oModel && typeof oModel.refresh === "function") {
                oModel.refresh();
            }
        },

        onRefreshKpiData: function () {
            MessageToast.show(getText("toastFetchingKpis", null, "Fetching latest AI performance metrics..."));
            loadStatistics();
        },

        onCloseKpiDialog: function () {
            if (_oDialogInstance) {
                _oDialogInstance.close();
            }
        }
    };

    return oDashboardController;
});
