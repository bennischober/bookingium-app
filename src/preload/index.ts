import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { exposeElectronTRPC } from 'electron-trpc/main'

// Custom APIs for renderer
const api = {
  uploadDocument: (eventId: number, sourcePath: string, targetFileName: string) =>
    ipcRenderer.invoke('document:upload', { eventId, sourcePath, targetFileName }),

  openDocument: (filePath: string) => ipcRenderer.invoke('document:open', { filePath }),

  revealDocumentInFolder: (filePath: string) =>
    ipcRenderer.invoke('document:revealInFolder', { filePath }),

  showOpenDialog: () => ipcRenderer.invoke('dialog:showOpenDialog'),

  uploadLogo: (companyId: number, sourcePath: string, fileName: string) =>
    ipcRenderer.invoke('logo:upload', { companyId, sourcePath, fileName }),

  deleteLogo: (relativePath: string) => ipcRenderer.invoke('logo:delete', { relativePath }),

  getLogoPath: (relativePath: string) => ipcRenderer.invoke('logo:getDataUrl', { relativePath }),

  generatePrintPreview: () => ipcRenderer.invoke('print:previewPdf'),

  savePrintPdf: (defaultFileName: string) =>
    ipcRenderer.invoke('print:savePdf', { defaultFileName }),

  openSavedPdf: (filePath: string) => ipcRenderer.invoke('print:openPdf', { filePath })
}

process.once('loaded', () => {
  exposeElectronTRPC()
})

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
