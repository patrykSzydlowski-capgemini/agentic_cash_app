// Level-4 custom code (skill fiori-elements §4): file upload has no UI.*
// annotation and no MCP extension, so the PaymentsList header action
// `uploadPayment` resolves to this PLAIN module (not a ControllerExtension —
// FE v4 resolves manifest press paths as loader modules `<dotted-name>.js`).
// FE press signature: (oEvent, oContext). No sap.ui.getCore().byId anywhere.
sap.ui.define([
	'sap/m/Dialog',
	'sap/m/Button',
	'sap/m/VBox',
	'sap/m/Text',
	'sap/ui/unified/FileUploader',
	'sap/m/BusyDialog',
	'sap/m/MessageToast',
	'sap/m/MessageBox',
	'sap/ui/core/Element',
	'sap/ui/core/Component'
], function (Dialog, Button, VBox, Text, FileUploader, BusyDialog, MessageToast, MessageBox, Element, Component) {
	'use strict';

	var oUploadDialog = null;
	var oFileUploader = null;
	var _oActiveModel = null;
	var _oExtensionAPI = null;

	function findModel(oThis, oContext, oEvent) {
		// 1. From binding context
		if (oContext && typeof oContext.getModel === 'function') {
			var m = oContext.getModel();
			if (m && typeof m.bindContext === 'function') return m;
		}

		// 2. From 'this' (Controller, ExtensionAPI, View, or Control)
		if (oThis) {
			if (typeof oThis.getModel === 'function') {
				var m = oThis.getModel();
				if (m && typeof m.bindContext === 'function') return m;
			}
			if (typeof oThis.getView === 'function') {
				var v = oThis.getView();
				if (v && typeof v.getModel === 'function') {
					var m = v.getModel();
					if (m && typeof m.bindContext === 'function') return m;
				}
			}
			if (typeof oThis.getExtensionAPI === 'function') {
				_oExtensionAPI = oThis.getExtensionAPI();
				if (_oExtensionAPI && typeof _oExtensionAPI.getModel === 'function') {
					var m = _oExtensionAPI.getModel();
					if (m && typeof m.bindContext === 'function') return m;
				}
			}
			if (oThis.base) {
				if (typeof oThis.base.getModel === 'function') {
					var m = oThis.base.getModel();
					if (m && typeof m.bindContext === 'function') return m;
				}
				if (typeof oThis.base.getExtensionAPI === 'function') {
					_oExtensionAPI = oThis.base.getExtensionAPI();
					if (_oExtensionAPI && typeof _oExtensionAPI.getModel === 'function') {
						var m = _oExtensionAPI.getModel();
						if (m && typeof m.bindContext === 'function') return m;
					}
				}
			}
		}

		// 3. From event or source control
		if (oEvent) {
			var oControl = (typeof oEvent.getSource === 'function') ? oEvent.getSource() : oEvent;
			while (oControl) {
				if (typeof oControl.getModel === 'function') {
					var m = oControl.getModel();
					if (m && typeof m.bindContext === 'function') return m;
				}
				oControl = oControl.getParent ? oControl.getParent() : null;
			}
		}

		// 4. From UIComponent registry
		if (Component && typeof Component.get === 'function') {
			var aCompNames = ['container', 'poc.cash.cashsyncui'];
			for (var i = 0; i < aCompNames.length; i++) {
				var comp = Component.get(aCompNames[i]);
				if (comp && typeof comp.getModel === 'function') {
					var m = comp.getModel();
					if (m && typeof m.bindContext === 'function') return m;
				}
			}
		}

		// 5. From Element registry (any control with default ODataModel)
		if (Element && Element.registry && typeof Element.registry.all === 'function') {
			var aAll = Element.registry.all();
			for (var sId in aAll) {
				var oEl = aAll[sId];
				if (oEl && typeof oEl.getModel === 'function') {
					var m = oEl.getModel();
					if (m && typeof m.bindContext === 'function') {
						return m;
					}
				}
			}
		}

		return null;
	}

	function onUploadPayment(oEvent, oContext) {
		var oModel = findModel(this, oContext, oEvent);
		if (oModel) {
			_oActiveModel = oModel;
		}

		if (!oUploadDialog) {
			oFileUploader = new FileUploader({
				name: 'remittance',
				fileType: ['pdf'],
				mimeType: ['application/pdf'],
				multiple: true,
				placeholder: 'Wybierz jedno lub więcej awizo PDF…',
				width: '100%'
			});
			oUploadDialog = new Dialog({
				title: 'Wgraj awizo płatnicze (PDF)',
				content: new VBox({
					items: [
						oFileUploader,
						new Text({ text: 'Możesz wybrać kilka plików PDF naraz (np. 3 pliki). Każdy dokument zostanie przeanalizowany przez pipeline AI i zapisany w kolejce.' })
					]
				}),
				beginButton: new Button({
					text: 'Wgraj',
					type: 'Emphasized',
					press: function () {
						onUploadConfirm(_oActiveModel || findModel(null, null, null));
					}
				}),
				endButton: new Button({
					text: 'Anuluj',
					press: function () {
						oUploadDialog.close();
					}
				})
			});
		}

		if (_oActiveModel) {
			oUploadDialog.setModel(_oActiveModel);
		}
		if (this && typeof this.getView === 'function') {
			var oView = this.getView();
			if (oView && typeof oView.addDependent === 'function') {
				oView.addDependent(oUploadDialog);
			}
		}

		oFileUploader.clear();
		oUploadDialog.open();
	}

	function readFileAsBase64(oFile) {
		return new Promise(function (resolve, reject) {
			var oReader = new FileReader();
			oReader.onload = function (oLoadEvent) {
				var sDataUrl = oLoadEvent.target.result;
				var sBase64 = String(sDataUrl).split(',')[1] || '';
				resolve({ name: oFile.name, base64: sBase64 });
			};
			oReader.onerror = function () {
				reject(new Error('Nie udało się odczytać pliku: ' + oFile.name));
			};
			oReader.readAsDataURL(oFile);
		});
	}

	function onUploadConfirm(oModel) {
		if (!oModel) {
			oModel = _oActiveModel || findModel(null, null, null);
		}

		var oDomRef = (oFileUploader.getDomRef && oFileUploader.getDomRef('fu'))
			|| (oFileUploader.getFocusDomRef && oFileUploader.getFocusDomRef())
			|| (oFileUploader.getDomRef && oFileUploader.getDomRef());
		var oFiles = (oDomRef && oDomRef.files)
			|| (oFileUploader.oFileUpload && oFileUploader.oFileUpload.files);

		if (!oFiles || oFiles.length === 0) {
			MessageToast.show('Wybierz co najmniej jeden plik PDF.');
			return;
		}

		var aFiles = Array.prototype.slice.call(oFiles);
		var oBusy = new BusyDialog({
			title: 'Przetwarzanie dokumentów…',
			text: 'Odczytywanie ' + aFiles.length + ' plik(ów)…'
		});
		oBusy.open();
		oUploadDialog.close();

		Promise.all(aFiles.map(readFileAsBase64)).then(function (aFileContents) {
			processFilesSequentially(oModel, aFileContents, oBusy);
		}).catch(function (oError) {
			oBusy.close();
			MessageBox.error((oError && oError.message) || 'Błąd podczas odczytu plików.');
		});
	}

	function processFilesSequentially(oModel, aFileContents, oBusy) {
		if (!oModel) {
			oBusy.close();
			MessageBox.error('Brak modelu OData — odśwież stronę.');
			return;
		}

		var aSuccesses = [];
		var aErrors = [];

		function processNext(i) {
			if (i >= aFileContents.length) {
				oBusy.close();
				var sSummary = 'Pomyślnie przetworzono ' + aSuccesses.length + ' z ' + aFileContents.length + ' dokumentów.';
				if (aErrors.length > 0) {
					MessageBox.warning(sSummary + '\n\nBłędy (' + aErrors.length + '):\n- ' + aErrors.join('\n- '));
				} else {
					MessageToast.show(sSummary);
				}
				if (_oExtensionAPI && typeof _oExtensionAPI.refresh === 'function') {
					_oExtensionAPI.refresh();
				} else if (oModel.refresh) {
					oModel.refresh();
				}
				return;
			}

			var oItem = aFileContents[i];
			oBusy.setText('AI analizuje dokument ' + (i + 1) + ' z ' + aFileContents.length + ' (' + oItem.name + ')…');

			var oContext = oModel.bindContext('/uploadPayment(...)');
			oContext.setParameter('fileName', oItem.name);
			oContext.setParameter('fileContent', oItem.base64);

			oContext.execute().then(function () {
				var oBound = oContext.getBoundContext && oContext.getBoundContext();
				var oResult = oBound && oBound.getObject ? oBound.getObject() : null;
				aSuccesses.push(oItem.name + (oResult && oResult.ID ? ' (' + oResult.ID + ')' : ''));
				processNext(i + 1);
			}).catch(function (oError) {
				var sErrMsg = (oError && oError.message) || 'Błąd przetwarzania';
				aErrors.push(oItem.name + ': ' + sErrMsg);
				processNext(i + 1);
			});
		}

		processNext(0);
	}

	return {
		onUploadPayment: onUploadPayment
	};
});
