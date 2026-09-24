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

            var totalTokens = stats.totalTokens || 0;
            var promptTokens = stats.totalPromptTokens || 0;
            var completionTokens = stats.totalCompletionTokens || 0;
            var totalCost = Number(stats.totalCost || 0);
            var totalCU = Number(stats.totalCapacityUnits || 0);
            var totalProcessed = stats.totalProcessed || 0;

            var avgTimeMs = stats.avgProcessingTimeMs || 0;
            var avgTokens = stats.avgTokensPerPayment || 0;
            var avgPrompt = stats.avgPromptTokens || 0;
            var avgCompletion = stats.avgCompletionTokens || 0;
            var avgCost = Number(stats.avgCost || 0);
            var avgCU = Number(stats.avgCapacityUnits || 0);

            var medTimeMs = stats.medianProcessingTimeMs || 0;
            var medTokens = stats.medianTokensPerPayment || 0;
            var medPrompt = stats.medianPromptTokens || 0;
            var medCompletion = stats.medianCompletionTokens || 0;
            var medCost = Number(stats.medianCost || 0);
            var medCU = Number(stats.medianCapacityUnits || 0);

            _oKpiModel.setData({
                totalTokens: totalTokens,
                totalTokensFormatted: formatNumber(totalTokens),
                totalPromptTokens: promptTokens,
                totalPromptTokensFormatted: formatNumber(promptTokens),
                totalCompletionTokens: completionTokens,
                totalCompletionTokensFormatted: formatNumber(completionTokens),
                totalCost: totalCost,
                totalCostFormatted: totalCost.toFixed(4),
                totalCapacityUnits: totalCU,
                totalCapacityUnitsFormatted: totalCU.toFixed(4),
                totalProcessed: totalProcessed,

                // Mean / Average metrics
                avgProcessingTimeMs: avgTimeMs,
                avgProcessingTimeSec: (avgTimeMs / 1000).toFixed(1),
                avgTokensPerPayment: avgTokens,
                avgTokensPerPaymentFormatted: formatNumber(avgTokens),
                avgPromptTokens: avgPrompt,
                avgPromptTokensFormatted: formatNumber(avgPrompt),
                avgCompletionTokens: avgCompletion,
                avgCompletionTokensFormatted: formatNumber(avgCompletion),
                avgCost: avgCost,
                avgCostFormatted: avgCost.toFixed(4),
                avgCapacityUnits: avgCU,
                avgCapacityUnitsFormatted: avgCU.toFixed(4),

                // Median metrics
                medianProcessingTimeMs: medTimeMs,
                medianProcessingTimeSec: (medTimeMs / 1000).toFixed(1),
                medianTokensPerPayment: medTokens,
                medianTokensPerPaymentFormatted: formatNumber(medTokens),
                medianPromptTokens: medPrompt,
                medianPromptTokensFormatted: formatNumber(medPrompt),
                medianCompletionTokens: medCompletion,
                medianCompletionTokensFormatted: formatNumber(medCompletion),
                medianCost: medCost,
                medianCostFormatted: medCost.toFixed(4),
                medianCapacityUnits: medCU,
                medianCapacityUnitsFormatted: medCU.toFixed(4),

                activeModel: stats.activeModel || "gemini-2.5-flash"
            });
        } catch (err) {
            MessageBox.error("Nie udało się pobrać statystyk AI: " + err.message);
        }
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
            MessageToast.show("Odświeżanie statystyk AI i tabeli...");
            loadStatistics();
            var oModel = findModel(this, oContext);
            if (oModel && typeof oModel.refresh === "function") {
                oModel.refresh();
            }
        },

        onRefreshKpiData: function () {
            MessageToast.show("Pobieranie najnowszych wskaźników...");
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
