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
	'sap/m/MessageBox'
], function (Dialog, Button, VBox, Text, FileUploader, BusyDialog, MessageToast, MessageBox) {
	'use strict';

	var oUploadDialog = null;
	var oFileUploader = null;

	function getModel(oEvent, oContext) {
		if (oContext && oContext.getModel) {
			return oContext.getModel();
		}
		if (oEvent && oEvent.getSource) {
			var oControl = oEvent.getSource();
			while (oControl) {
				if (oControl.getModel) {
					var oModel = oControl.getModel();
					if (oModel) {
						return oModel;
					}
				}
				oControl = oControl.getParent ? oControl.getParent() : null;
			}
		}
		return null;
	}

	function onUploadPayment(oEvent, oContext) {
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
						onUploadConfirm(getModel(oEvent, oContext));
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
		oFileUploader.clear();
		oUploadDialog.open();
	}

	function onUploadConfirm(oModel) {
		var oFiles = oFileUploader.oFileUpload && oFileUploader.oFileUpload.files;
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
			if (oModel.refresh) {
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
