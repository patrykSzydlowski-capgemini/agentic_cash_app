// Level-4 custom code (skill fiori-elements §4): "Revalidate Items" starts a
// long-running pipeline run in the background (revalidatePipeline returns at
// once, a synchronous run outlived the approuter timeout -> 502). Fiori Elements
// has no annotation or manifest setting for polling an action's progress, so
// this module opens a progress dialog and polls getPipelineProgress until the
// run has finished, then refreshes the tables.
// FPM table action handler signature: (oContext, aSelectedContexts), this = ExtensionAPI.
// Selection decides the scope: none -> everything; Open Items tab -> the selected
// open items and the payments linked to them; All Payments tab -> the selected payments.
sap.ui.define([
	'sap/ui/core/Fragment',
	'sap/ui/model/json/JSONModel',
	'sap/m/MessageToast',
	'sap/m/MessageBox',
	'sap/ui/core/Component',
	'sap/ui/core/ElementRegistry'
], function (Fragment, JSONModel, MessageToast, MessageBox, Component, ElementRegistry) {
	'use strict';

	var POLL_INTERVAL_MS = 1500;
	var PHASE_TEXT_KEYS = {
		erpSync: 'revalidatePhaseErpSync',
		mailIntake: 'revalidatePhaseMailIntake',
		extraction: 'revalidatePhaseExtraction',
		matching: 'revalidatePhaseMatching',
		assessment: 'revalidatePhaseAssessment',
		done: 'revalidatePhaseDone'
	};

	var _pDialog = null;
	var _oDialog = null;
	var _oODataModel = null;
	var _oExtensionAPI = null;
	var _oI18nModel = null;
	var _sRunId = null;
	var _oLastProgress = null;
	var _iPollTimer = null;
	var _iClockTimer = null;
	var _oProgressModel = new JSONModel(emptyState());

	function emptyState() {
		return {
			running: false,
			percent: 0,
			percentText: '0 %',
			state: 'Information',
			scopeText: '',
			stepText: '',
			processedText: '',
			elapsedText: '',
			noticeText: '',
			connectionText: '',
			resultText: '',
			resultType: 'Information'
		};
	}

	function findComponentModel(sName) {
		var aCompNames = ['container', 'poc.cash.cashsyncui'];
		for (var i = 0; i < aCompNames.length; i++) {
			var oComp = Component.getComponentById(aCompNames[i]);
			var oModel = oComp && oComp.getModel(sName);
			if (oModel) return oModel;
		}
		var mAll = ElementRegistry.all();
		for (var sId in mAll) {
			var oEl = mAll[sId];
			var oElModel = oEl && typeof oEl.getModel === 'function' ? oEl.getModel(sName) : null;
			if (oElModel && (sName || typeof oElModel.bindContext === 'function')) return oElModel;
		}
		return null;
	}

	function findODataModel(oThis, oContext) {
		var oModel = oContext && typeof oContext.getModel === 'function' ? oContext.getModel() : null;
		if (!oModel && oThis && typeof oThis.getModel === 'function') oModel = oThis.getModel();
		if (oModel && typeof oModel.bindContext === 'function') return oModel;
		return findComponentModel(undefined);
	}

	function getText(sKey, aArgs, sFallback) {
		try {
			var oBundle = _oI18nModel && _oI18nModel.getResourceBundle();
			if (oBundle && oBundle.hasText(sKey)) return oBundle.getText(sKey, aArgs);
		} catch (e) {
			// fall through to the fallback text
		}
		var sText = sFallback || sKey;
		(aArgs || []).forEach(function (vArg, iIdx) {
			sText = sText.replace('{' + iIdx + '}', vArg);
		});
		return sText;
	}

	// Open Items tab -> OpenItemId, All Payments tab -> payment ID; other rows are ignored.
	function collectScope(aSelectedContexts) {
		var oScope = { openItemIds: [], paymentIds: [] };
		(aSelectedContexts || []).forEach(function (oCtx) {
			var sPath = oCtx && typeof oCtx.getPath === 'function' ? oCtx.getPath() : '';
			if (sPath.indexOf('/OpenItem(') === 0) {
				oScope.openItemIds.push(oCtx.getProperty('OpenItemId'));
			} else if (sPath.indexOf('/Payments(') === 0) {
				oScope.paymentIds.push(oCtx.getProperty('ID'));
			}
		});
		oScope.openItemIds = oScope.openItemIds.filter(Boolean);
		oScope.paymentIds = oScope.paymentIds.filter(Boolean);
		return oScope;
	}

	function startRun(oScope) {
		var oBinding = _oODataModel.bindContext('/revalidatePipeline(...)', null, { $$groupId: '$direct' });
		oBinding.setParameter('openItemIds', oScope.openItemIds);
		oBinding.setParameter('paymentIds', oScope.paymentIds);
		return oBinding.execute('$direct').then(function () {
			return oBinding.getBoundContext().requestObject();
		});
	}

	function fetchProgress() {
		var oBinding = _oODataModel.bindContext('/getPipelineProgress(...)', null, { $$groupId: '$direct' });
		return oBinding.execute('$direct').then(function () {
			return oBinding.getBoundContext().requestObject();
		});
	}

	function formatDuration(iMs) {
		var iSeconds = Math.max(0, Math.floor(iMs / 1000));
		var iMinutes = Math.floor(iSeconds / 60);
		var sSeconds = String(iSeconds % 60).padStart(2, '0');
		return iMinutes + ':' + sSeconds;
	}

	function elapsedMs(oProgress) {
		if (!oProgress || !oProgress.startedAt) return 0;
		var iEnd = oProgress.finishedAt ? Date.parse(oProgress.finishedAt) : Date.now();
		return iEnd - Date.parse(oProgress.startedAt);
	}

	function scopeText(oProgress) {
		if (oProgress.scope === 'openItems') return getText('revalidateScopeOpenItems', [oProgress.selectedCount]);
		if (oProgress.scope === 'payments') return getText('revalidateScopePayments', [oProgress.selectedCount]);
		return getText('revalidateScopeAll');
	}

	function resultText(oProgress) {
		if (oProgress.status === 'completed') {
			return getText('revalidateResultCompleted', [
				oProgress.evaluated, oProgress.matched, oProgress.review, oProgress.extracted, oProgress.failed
			]);
		}
		if (oProgress.status === 'failed') return getText('revalidateResultFailed', [oProgress.message || '']);
		return '';
	}

	function applyProgress(oProgress) {
		_oLastProgress = oProgress;
		var bRunning = oProgress.status === 'running';
		var sPhase = getText(PHASE_TEXT_KEYS[oProgress.phase] || 'revalidatePhaseStarting');
		var iStep = Math.max(1, oProgress.phaseIndex || 0);
		_oProgressModel.setProperty('/running', bRunning);
		_oProgressModel.setProperty('/percent', oProgress.percent || 0);
		_oProgressModel.setProperty('/percentText', (oProgress.percent || 0) + ' %');
		_oProgressModel.setProperty('/state', oProgress.status === 'failed' ? 'Error' : oProgress.status === 'completed' ? 'Success' : 'Information');
		_oProgressModel.setProperty('/scopeText', scopeText(oProgress));
		_oProgressModel.setProperty('/stepText', bRunning
			? getText('revalidateStep', [iStep, oProgress.phaseCount, sPhase])
			: sPhase);
		_oProgressModel.setProperty('/processedText', bRunning && oProgress.total > 0
			? getText('revalidateProcessed', [oProgress.processed, oProgress.total])
			: '');
		_oProgressModel.setProperty('/resultText', resultText(oProgress));
		_oProgressModel.setProperty('/resultType', oProgress.status === 'failed' ? 'Error' : 'Success');
		updateClock();
	}

	function updateClock() {
		_oProgressModel.setProperty('/elapsedText', getText('revalidateElapsed', [formatDuration(elapsedMs(_oLastProgress))]));
	}

	function stopTimers() {
		clearTimeout(_iPollTimer);
		clearInterval(_iClockTimer);
		_iPollTimer = null;
		_iClockTimer = null;
	}

	function schedulePoll() {
		_iPollTimer = setTimeout(poll, POLL_INTERVAL_MS);
	}

	// Transient errors (network, approuter) do not end the dialog; the run continues server-side.
	function poll() {
		fetchProgress().then(function (oProgress) {
			_oProgressModel.setProperty('/connectionText', '');
			if (oProgress.runId !== _sRunId) {
				// Server restarted or another run replaced ours: show what is known and stop.
				oProgress = Object.assign({}, _oLastProgress, { status: 'failed', message: getText('revalidateRunLost') });
			}
			applyProgress(oProgress);
			if (oProgress.status === 'running') {
				schedulePoll();
			} else {
				finish(oProgress);
			}
		}).catch(function () {
			_oProgressModel.setProperty('/connectionText', getText('revalidateConnectionLost'));
			schedulePoll();
		});
	}

	function finish(oProgress) {
		stopTimers();
		refreshTables();
		if (!_oDialog || !_oDialog.isOpen()) {
			if (oProgress.status === 'failed') {
				MessageBox.error(resultText(oProgress));
			} else {
				MessageToast.show(resultText(oProgress));
			}
		}
	}

	function refreshTables() {
		try {
			if (_oExtensionAPI && typeof _oExtensionAPI.refresh === 'function') _oExtensionAPI.refresh();
		} catch (e) {
			// the model refresh below covers all tabs
		}
		try {
			_oODataModel.refresh();
		} catch (e) {
			console.warn('[Revalidate] Model refresh failed', e);
		}
	}

	function track(oProgress, sNotice) {
		_sRunId = oProgress.runId;
		_oProgressModel.setData(emptyState());
		_oProgressModel.setProperty('/noticeText', sNotice || '');
		applyProgress(oProgress);
		stopTimers();
		if (oProgress.status === 'running') {
			_iClockTimer = setInterval(updateClock, 1000);
			schedulePoll();
		} else {
			finish(oProgress);
		}
	}

	function openDialog() {
		if (!_pDialog) {
			_pDialog = Fragment.load({
				name: 'poc.cash.cashsyncui.ext.RevalidateProgressDialog',
				controller: oHandler
			}).then(function (oDialog) {
				_oDialog = oDialog;
				oDialog.setModel(_oProgressModel, 'progress');
				if (_oI18nModel) oDialog.setModel(_oI18nModel, 'i18n');
				return oDialog;
			});
		}
		return _pDialog.then(function (oDialog) {
			if (!oDialog.isOpen()) oDialog.open();
			return oDialog;
		});
	}

	var oHandler = {
		onRevalidatePipeline: function (oContext, aSelectedContexts) {
			_oExtensionAPI = this && typeof this.refresh === 'function' ? this : null;
			_oODataModel = findODataModel(this, oContext);
			_oI18nModel = _oI18nModel || findComponentModel('i18n');
			if (!_oODataModel) {
				MessageBox.error(getText('uploadModelError', null, 'OData model not found — please reload the page.'));
				return;
			}
			// A run of this browser session is still being tracked: just show it again.
			if (_iClockTimer && _oLastProgress && _oLastProgress.status === 'running') {
				openDialog();
				return;
			}
			var oScope = collectScope(aSelectedContexts);
			startRun(oScope).then(function (oProgress) {
				track(oProgress);
				openDialog();
			}).catch(function (oError) {
				if (oError && oError.status === 409) {
					// Another run (startup, mail sync, other user) is active: follow that one.
					return fetchProgress().then(function (oProgress) {
						track(oProgress, getText('revalidateAlreadyRunning'));
						openDialog();
					});
				}
				throw oError;
			}).catch(function (oError) {
				MessageBox.error((oError && oError.message) || getText('revalidateResultFailed', ['']));
			});
		},

		onRunInBackground: function () {
			if (_oDialog) _oDialog.close();
		},

		onCloseDialog: function () {
			if (_oDialog) _oDialog.close();
		},

		onAfterClose: function () {
			if (_oLastProgress && _oLastProgress.status === 'running') {
				MessageToast.show(getText('revalidateBackgroundToast'));
			}
		}
	};

	return oHandler;
});
