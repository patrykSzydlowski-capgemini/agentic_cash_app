// Level-4 custom code (skill fiori-elements §4): file upload has no UI.*
// annotation and no MCP extension, so the PaymentsList header action
// `uploadPayment` resolves to this PLAIN module (not a ControllerExtension —
// FE v4 resolves manifest press paths as loader modules `<dotted-name>.js`).
// FE press signature: (oEvent, oContext). No sap.ui.getCore().byId anywhere.
sap.ui.define([
	'sap/ui/core/Fragment',
	'sap/ui/model/json/JSONModel',
	'sap/ui/model/resource/ResourceModel',
	'sap/m/MessageToast',
	'sap/m/MessageBox',
	'sap/ui/core/Component',
	'sap/ui/core/ElementRegistry'
], function (Fragment, JSONModel, ResourceModel, MessageToast, MessageBox, Component, ElementRegistry) {
	'use strict';

	var _pUploadDialog = null;
	var _oUploadDialog = null;
	var _oActiveModel = null;
	var _oExtensionAPI = null;
	var _aSelectedRawFiles = [];

	var _oFallbackI18nModel = new ResourceModel({
		bundleName: 'poc.cash.cashsyncui.i18n.i18n'
	});

	var _oUploadModel = new JSONModel({
		files: [],
		count: 0,
		hasFiles: false,
		isUploading: false,
		progressPercent: 0,
		progressText: ''
	});

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
		if (Component && typeof Component.getComponentById === 'function') {
			var aCompNames = ['container', 'poc.cash.cashsyncui'];
			for (var i = 0; i < aCompNames.length; i++) {
				var comp = Component.getComponentById(aCompNames[i]);
				if (comp && typeof comp.getModel === 'function') {
					var m = comp.getModel();
					if (m && typeof m.bindContext === 'function') return m;
				}
			}
		}

		// 5. From Element registry (any control with default ODataModel)
		if (ElementRegistry && typeof ElementRegistry.all === 'function') {
			var aAll = ElementRegistry.all();
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

	function findI18nModel(oThis) {
		try {
			if (oThis) {
				if (typeof oThis.getModel === 'function') {
					var oI18n = oThis.getModel('i18n');
					if (oI18n) return oI18n;
				}
				if (typeof oThis.getView === 'function') {
					var oView = oThis.getView();
					if (oView && typeof oView.getModel === 'function') {
						var oI18nView = oView.getModel('i18n');
						if (oI18nView) return oI18nView;
					}
				}
				if (typeof oThis.getExtensionAPI === 'function') {
					var oExt = oThis.getExtensionAPI();
					if (oExt && typeof oExt.getModel === 'function') {
						var oI18nExt = oExt.getModel('i18n');
						if (oI18nExt) return oI18nExt;
					}
				}
			}
			if (_oExtensionAPI && typeof _oExtensionAPI.getModel === 'function') {
				var oI18n = _oExtensionAPI.getModel('i18n');
				if (oI18n) return oI18n;
			}
			if (Component && typeof Component.getComponentById === 'function') {
				var aCompNames = ['container', 'poc.cash.cashsyncui'];
				for (var i = 0; i < aCompNames.length; i++) {
					var oComp = Component.getComponentById(aCompNames[i]);
					if (oComp && typeof oComp.getModel === 'function') {
						var oI18nComp = oComp.getModel('i18n');
						if (oI18nComp) return oI18nComp;
					}
				}
			}
			if (ElementRegistry && typeof ElementRegistry.all === 'function') {
				var aAll = ElementRegistry.all();
				for (var sId in aAll) {
					var oEl = aAll[sId];
					if (oEl && typeof oEl.getModel === 'function') {
						var oI18nEl = oEl.getModel('i18n');
						if (oI18nEl) return oI18nEl;
					}
				}
			}
		} catch (e) {
			// ignore and use fallback
		}
		return _oFallbackI18nModel;
	}

	function getText(sKey, aArgs, sFallback) {
		try {
			var oI18n = findI18nModel();
			if (oI18n && typeof oI18n.getResourceBundle === 'function') {
				var oBundle = oI18n.getResourceBundle();
				if (oBundle && typeof oBundle.getText === 'function') {
					return oBundle.getText(sKey, aArgs);
				}
			}
		} catch (e) {
			// ignore and use fallback
		}
		var sRes = sFallback || sKey;
		if (Array.isArray(aArgs)) {
			aArgs.forEach(function (arg, idx) {
				sRes = sRes.replace('{' + idx + '}', arg);
			});
		}
		return sRes;
	}

	function formatFileSize(bytes) {
		if (!bytes || bytes === 0) return '0 KB';
		if (bytes < 1024 * 1024) {
			return (bytes / 1024).toFixed(1) + ' KB';
		}
		return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
	}

	function updateUploadModel() {
		var aItems = _aSelectedRawFiles.map(function (f, idx) {
			return {
				index: idx,
				name: f.name,
				size: f.size,
				sizeFormatted: formatFileSize(f.size)
			};
		});
		_oUploadModel.setData({
			files: aItems,
			count: aItems.length,
			hasFiles: aItems.length > 0,
			isUploading: _oUploadModel.getProperty('/isUploading') || false,
			progressPercent: _oUploadModel.getProperty('/progressPercent') || 0,
			progressText: _oUploadModel.getProperty('/progressText') || ''
		});
	}

	function addRawFiles(aFiles) {
		if (!aFiles || aFiles.length === 0) return;
		var bAdded = false;
		var bHasNonPdf = false;
		for (var i = 0; i < aFiles.length; i++) {
			var file = aFiles[i];
			var sName = file.name || '';
			if (!sName.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
				bHasNonPdf = true;
				continue;
			}
			var bExists = _aSelectedRawFiles.some(function (existing) {
				return existing.name === file.name && existing.size === file.size;
			});
			if (!bExists) {
				_aSelectedRawFiles.push(file);
				bAdded = true;
			}
		}
		if (bHasNonPdf) {
			MessageToast.show(getText('uploadInvalidFileFormat', null, 'Only PDF files are supported.'));
		}
		if (bAdded) {
			updateUploadModel();
		}
	}

	function setupDragAndDrop() {
		if (!_oUploadDialog) return;
		var oDom = null;
		if (_oUploadDialog.getDomRef) {
			var oDialogDom = _oUploadDialog.getDomRef();
			oDom = oDialogDom ? oDialogDom.querySelector('.uploadDropZoneBox') : null;
		}
		if (oDom && !oDom._dadBound) {
			oDom._dadBound = true;
			oDom.addEventListener('dragover', function (e) {
				e.preventDefault();
				e.stopPropagation();
				oDom.classList.add('uploadDropZoneActive');
			});
			oDom.addEventListener('dragleave', function (e) {
				e.preventDefault();
				e.stopPropagation();
				oDom.classList.remove('uploadDropZoneActive');
			});
			oDom.addEventListener('drop', function (e) {
				e.preventDefault();
				e.stopPropagation();
				oDom.classList.remove('uploadDropZoneActive');
				if (e.dataTransfer && e.dataTransfer.files) {
					addRawFiles(Array.prototype.slice.call(e.dataTransfer.files));
				}
			});
		}
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
				reject(new Error('Failed to read file: ' + oFile.name));
			};
			oReader.readAsDataURL(oFile);
		});
	}

	var oUploadController = {
		onFileChange: function (oEvent) {
			var oFu = oEvent.getSource();
			var oDomRef = (oFu.getFocusDomRef && oFu.getFocusDomRef()) || (oFu.getDomRef && oFu.getDomRef());
			var oInput = oDomRef && (oDomRef.querySelector ? oDomRef.querySelector('input[type="file"]') : null);
			var aFiles = (oInput && oInput.files) || (oDomRef && oDomRef.files) || oEvent.getParameter('files');
			if (aFiles && aFiles.length > 0) {
				addRawFiles(Array.prototype.slice.call(aFiles));
			}
			if (oFu && typeof oFu.clear === 'function') {
				oFu.clear();
			}
		},

		onRemoveFile: function (oEvent) {
			var oCtx = oEvent.getSource().getBindingContext('upload');
			if (oCtx) {
				var oObj = oCtx.getObject();
				_aSelectedRawFiles = _aSelectedRawFiles.filter(function (f) {
					return f.name !== oObj.name;
				});
				updateUploadModel();
			}
		},

		onClearFiles: function () {
			_aSelectedRawFiles = [];
			updateUploadModel();
		},

		formatSelectedTitle: function (sPattern, iCount) {
			var sBase = sPattern || getText('uploadSelectedFilesTitle', [iCount || 0], 'Selected Documents (' + (iCount || 0) + ')');
			return sBase.replace('{0}', iCount || 0);
		},

		formatStartButton: function (sPattern, iCount) {
			var sBase = sPattern || getText('uploadBtnStartAi', [iCount || 0], 'Start AI Processing (' + (iCount || 0) + ')');
			return sBase.replace('{0}', iCount || 0);
		},

		onCancelDialog: function () {
			if (_oUploadDialog) {
				_oUploadDialog.close();
			}
		},

		onConfirmUpload: function () {
			if (!_aSelectedRawFiles || _aSelectedRawFiles.length === 0) {
				MessageToast.show(getText('uploadSelectFilePrompt', null, 'Please select at least one PDF file.'));
				return;
			}

			var oModel = _oActiveModel || findModel(null, null, null);
			if (!oModel) {
				MessageBox.error(getText('uploadModelError', null, 'OData model not found — please reload the page.'));
				return;
			}

			var aFilesToUpload = _aSelectedRawFiles.slice();
			_oUploadModel.setProperty('/isUploading', true);
			_oUploadModel.setProperty('/progressPercent', 0);
			_oUploadModel.setProperty('/progressText', getText('uploadBusyReading', [aFilesToUpload.length], 'Reading ' + aFilesToUpload.length + ' file(s)...'));

			Promise.all(aFilesToUpload.map(readFileAsBase64)).then(function (aFileContents) {
				processFilesSequentially(oModel, aFileContents);
			}).catch(function (oError) {
				_oUploadModel.setProperty('/isUploading', false);
				MessageBox.error((oError && oError.message) || 'Error reading files.');
			});
		}
	};

	function processFilesSequentially(oModel, aFileContents) {
		var aSuccesses = [];
		var aErrors = [];
		var iTotal = aFileContents.length;

		function processNext(i) {
			if (i >= iTotal) {
				_oUploadModel.setProperty('/isUploading', false);
				_oUploadModel.setProperty('/progressPercent', 100);
				if (_oUploadDialog) {
					_oUploadDialog.close();
				}

				_aSelectedRawFiles = [];
				updateUploadModel();

				var sSummary = getText('uploadSuccessSummary', [aSuccesses.length, iTotal], 'Successfully processed ' + aSuccesses.length + ' of ' + iTotal + ' documents.');
				if (aErrors.length > 0) {
					MessageBox.warning(sSummary + '\n\n' + getText('uploadErrorsTitle', [aErrors.length, aErrors.join('\n- ')], 'Errors (' + aErrors.length + '):\n- ' + aErrors.join('\n- ')));
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
			var iCurrentPercent = Math.round((i / iTotal) * 100);
			_oUploadModel.setProperty('/progressPercent', iCurrentPercent);
			_oUploadModel.setProperty('/progressText', getText('uploadBusyProgress', [i + 1, iTotal, oItem.name], 'AI is analyzing document ' + (i + 1) + ' of ' + iTotal + ' (' + oItem.name + ')...'));

			var oContext = oModel.bindContext('/uploadPayment(...)', null, { $$groupId: '$direct' });
			oContext.setParameter('fileName', oItem.name);
			oContext.setParameter('fileContent', oItem.base64);

			oContext.execute('$direct').then(function () {
				var oBound = oContext.getBoundContext && oContext.getBoundContext();
				var oResult = oBound && oBound.getObject ? oBound.getObject() : null;
				aSuccesses.push(oItem.name + (oResult && oResult.ID ? ' (' + oResult.ID + ')' : ''));
				var iDonePercent = Math.round(((i + 1) / iTotal) * 100);
				_oUploadModel.setProperty('/progressPercent', iDonePercent);
				processNext(i + 1);
			}).catch(function (oError) {
				var sErrMsg = (oError && oError.message) || 'Processing error';
				aErrors.push(oItem.name + ': ' + sErrMsg);
				processNext(i + 1);
			});
		}

		processNext(0);
	}

	function onUploadPayment(oEvent, oContext) {
		var oModel = findModel(this, oContext, oEvent);
		if (oModel) {
			_oActiveModel = oModel;
		}

		_aSelectedRawFiles = [];
		_oUploadModel.setData({
			files: [],
			count: 0,
			hasFiles: false,
			isUploading: false,
			progressPercent: 0,
			progressText: ''
		});

		var that = this;
		var oI18n = findI18nModel(this) || _oFallbackI18nModel;

		if (!_pUploadDialog) {
			_pUploadDialog = Fragment.load({
				name: 'poc.cash.cashsyncui.ext.UploadPaymentDialog',
				controller: oUploadController
			}).then(function (oDialog) {
				_oUploadDialog = oDialog;
				_oUploadDialog.setModel(_oUploadModel, 'upload');
				_oUploadDialog.setModel(oI18n, 'i18n');

				if (_oActiveModel) {
					_oUploadDialog.setModel(_oActiveModel);
				}

				_oUploadDialog.attachAfterOpen(function () {
					setTimeout(setupDragAndDrop, 150);
				});

				return _oUploadDialog;
			});
		}

		_pUploadDialog.then(function (oDialog) {
			var oCurrentI18n = findI18nModel(that) || _oFallbackI18nModel;
			oDialog.setModel(oCurrentI18n, 'i18n');

			if (_oActiveModel) {
				oDialog.setModel(_oActiveModel);
			}
			if (that && typeof that.getView === 'function') {
				var oView = that.getView();
				if (oView && typeof oView.addDependent === 'function') {
					oView.addDependent(oDialog);
				}
			}
			oDialog.open();
		});
	}

	function onOpenPdfInNewTab(oEvent) {
		var oSource = oEvent && typeof oEvent.getSource === 'function' ? oEvent.getSource() : null;
		var oContext = oSource ? oSource.getBindingContext() : null;
		var sId = null;

		if (oContext) {
			sId = oContext.getProperty('ID');
		}

		if (!sId && oSource) {
			var oParent = oSource.getParent ? oSource.getParent() : null;
			while (oParent && !oParent.getBindingContext()) {
				oParent = oParent.getParent ? oParent.getParent() : null;
			}
			if (oParent && oParent.getBindingContext()) {
				sId = oParent.getBindingContext().getProperty('ID');
			}
		}

		if (sId) {
			window.open('/odata/v4/cash-sync/Payments(' + sId + ')/attachmentContent', '_blank');
		} else {
			MessageToast.show('Could not resolve payment ID for PDF view.');
		}
	}

	function onDownloadPdf(oEvent) {
		var oSource = oEvent && typeof oEvent.getSource === 'function' ? oEvent.getSource() : null;
		var oContext = oSource ? oSource.getBindingContext() : null;
		var sId = null;
		var sFileName = 'Remittance_Advice.pdf';

		if (oContext) {
			sId = oContext.getProperty('ID');
			sFileName = oContext.getProperty('fileName') || sFileName;
		}

		if (!sId && oSource) {
			var oParent = oSource.getParent ? oSource.getParent() : null;
			while (oParent && !oParent.getBindingContext()) {
				oParent = oParent.getParent ? oParent.getParent() : null;
			}
			if (oParent && oParent.getBindingContext()) {
				sId = oParent.getBindingContext().getProperty('ID');
				sFileName = oParent.getBindingContext().getProperty('fileName') || sFileName;
			}
		}

		if (sId) {
			var oLink = document.createElement('a');
			oLink.href = '/odata/v4/cash-sync/Payments(' + sId + ')/attachmentContent';
			oLink.download = sFileName;
			document.body.appendChild(oLink);
			oLink.click();
			document.body.removeChild(oLink);
		} else {
			MessageToast.show('Could not resolve payment ID for PDF download.');
		}
	}

	return {
		onUploadPayment: onUploadPayment,
		onOpenPdfInNewTab: onOpenPdfInNewTab,
		onDownloadPdf: onDownloadPdf
	};
});
