import { ElectronAPI } from '@electron-toolkit/preload'

export interface DocumentAPI {
  uploadDocument: (
    eventId: number,
    sourcePath: string,
    targetFileName: string
  ) => Promise<{
    success: boolean
    relativePath?: string
    fileName?: string
    fileSize?: number
    error?: string
  }>
  openDocument: (filePath: string) => Promise<{ success: boolean; error?: string }>
  revealDocumentInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
  showOpenDialog: () => Promise<{
    canceled: boolean
    filePaths: string[]
    error?: string
  }>
  uploadLogo: (
    companyId: number,
    sourcePath: string,
    fileName: string
  ) => Promise<{ success: boolean; relativePath?: string; error?: string }>
  deleteLogo: (relativePath: string) => Promise<{ success: boolean; error?: string }>
  getLogoPath: (relativePath: string) => Promise<{
    success: boolean
    dataUrl?: string
    error?: string
  }>
  /** The real print output (printToPDF of the current window) as PDF bytes */
  generatePrintPreview: () => Promise<{
    success: boolean
    data?: Uint8Array
    error?: string
  }>
  /** Saves the real print output via a save dialog prefilled with the file name */
  savePrintPdf: (defaultFileName: string) => Promise<{
    success: boolean
    canceled?: boolean
    filePath?: string
    error?: string
  }>
  openSavedPdf: (filePath: string) => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DocumentAPI
  }
}
