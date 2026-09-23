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
				placeholder: 'Wybierz awizo PDF…',
				width: '100%'
			});
			oUploadDialog = new Dialog({
				title: 'Wgraj awizo płatnicze (PDF)',
				content: new VBox({
					items: [
						oFileUploader,
						new Text({ text: 'Plik trafia do akcji uploadPayment i przechodzi pełny pipeline AI.' })
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
			MessageToast.show('Wybierz plik PDF.');
			return;
		}
		var oFile = oFiles[0];
		var oReader = new FileReader();
		oReader.onload = function (oLoadEvent) {
			var sDataUrl = oLoadEvent.target.result;
			var sBase64 = String(sDataUrl).split(',')[1] || '';
			invokeUploadPayment(oModel, oFile.name, sBase64);
		};
		oReader.onerror = function () {
			MessageBox.error('Nie udało się odczytać pliku.');
		};
		oReader.readAsDataURL(oFile);
	}

	function invokeUploadPayment(oModel, sFileName, sBase64) {
		if (!oModel) {
			MessageBox.error('Brak modelu OData — odśwież stronę.');
			return;
		}
		var oBusy = new BusyDialog({ title: 'Przetwarzanie…', text: 'AI analizuje dokument…' });
		oBusy.open();
		oUploadDialog.close();
		var oContext = oModel.bindContext('/uploadPayment(...)');
		oContext.setParameter('fileName', sFileName);
		oContext.setParameter('fileContent', sBase64);
		oContext.execute().then(function () {
			oBusy.close();
			var oBound = oContext.getBoundContext && oContext.getBoundContext();
			var oResult = oBound && oBound.getObject ? oBound.getObject() : null;
			MessageToast.show('Zapisano płatność ' + (oResult && oResult.ID ? oResult.ID : ''));
			if (_oExtensionAPI && typeof _oExtensionAPI.refresh === 'function') {
				_oExtensionAPI.refresh();
			} else if (oModel.refresh) {
				oModel.refresh();
			}
		}).catch(function (oError) {
			oBusy.close();
			var sMessage = (oError && oError.message) || 'Wgrywanie nie powiodło się.';
			MessageBox.error(sMessage);
		});
	}

	return {
		onUploadPayment: onUploadPayment
	};
});
