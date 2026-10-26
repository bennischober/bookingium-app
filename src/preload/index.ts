import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { exposeElectronTRPC } from 'electron-trpc/main'

// Custom APIs for renderer
const api = {
  // Local path of a dropped file (File.path no longer exists since Electron 32)
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  openDocument: (filePath: string) => ipcRenderer.invoke('document:open', { filePath }),

  revealDocumentInFolder: (filePath: string) =>
    ipcRenderer.invoke('document:revealInFolder', { filePath }),

  showOpenDialog: () => ipcRenderer.invoke('dialog:showOpenDialog'),

  uploadLogo: (companyId: number, sourcePath: string, fileName: string) =>
    ipcRenderer.invoke('logo:upload', { companyId, sourcePath, fileName }),

  deleteLogo: (relativePath: string) => ipcRenderer.invoke('logo:delete', { relativePath }),

  getLogoPath: (relativePath: string) => ipcRenderer.invoke('logo:getDataUrl', { relativePath }),

  generatePrintPreview: () => ipcRenderer.invoke('print:previewPdf'),

  savePrintPdf: (defaultFileName: string, invoiceId?: number) =>
    ipcRenderer.invoke('print:savePdf', { defaultFileName, invoiceId }),

  openSavedPdf: (filePath: string) => ipcRenderer.invoke('print:openPdf', { filePath }),

  saveEInvoiceXml: (invoiceId: number, defaultFileName: string) =>
    ipcRenderer.invoke('einvoice:saveXml', { invoiceId, defaultFileName }),

  sendInvoiceEmail: (
    invoiceId: number,
    fileName: string,
    lang: 'de' | 'en',
    kind: 'invoice' | 'reminder' | 'dunning' = 'invoice'
  ) => ipcRenderer.invoke('invoice:email', { invoiceId, fileName, lang, kind }),

  showEmailFile: (filePath: string) => ipcRenderer.invoke('mail:showFile', { filePath }),

  /** Copy a mail's link address; the main process holds the clipboard and re-checks the scheme */
  copyMailLink: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('mail:copyLink', { url }),

  openMailWindow: (accountId: string, messageId: number) =>
    ipcRenderer.invoke('mail:openWindow', { accountId, messageId }),

  /** The draft is stored; close the window main was holding open */
  closeMailWindow: () => ipcRenderer.send('mail:closeWindow'),

  pickImportWorkbook: () => ipcRenderer.invoke('import:pickWorkbook')
}

process.once('loaded', () => {
  exposeElectronTRPC()
})

// Use `contextBridge` APIs to expose the app API to the renderer only if context isolation is
// enabled, otherwise just add to the DOM global. I11: no `window.electron` - the toolkit's raw
// ipcRenderer (send/invoke on any channel) gave any script in the renderer every channel.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
