import { ElectronAPI } from '@electron-toolkit/preload'
import type { ImportWorkbook } from '../main/api/schemas/import.schema'
import type { EInvoiceCheckDto } from '../main/api/schemas/invoice.schema'

export interface DocumentAPI {
  /** Local path of a file dropped from the file manager ('' if it has none) */
  getPathForFile: (file: File) => string
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
  /**
   * Saves the real print output via a save dialog prefilled with the file
   * name; with an invoice id the e-invoice is embedded when it is complete
   */
  savePrintPdf: (
    defaultFileName: string,
    invoiceId?: number
  ) => Promise<{
    success: boolean
    canceled?: boolean
    filePath?: string
    /** Set for invoices: whether the e-invoice was embedded, or why not */
    eInvoice?: EInvoiceCheckDto
    error?: string
  }>
  openSavedPdf: (filePath: string) => Promise<{ success: boolean; error?: string }>
  /** Saves an invoice's e-invoice (XRechnung) as XML via a save dialog */
  saveEInvoiceXml: (
    invoiceId: number,
    defaultFileName: string
  ) => Promise<{
    success: boolean
    canceled?: boolean
    filePath?: string
    eInvoice?: EInvoiceCheckDto
    error?: string
  }>
  /** Open dialog for an Excel file; returns its sheets for the import dialog */
  pickImportWorkbook: () => Promise<{
    success: boolean
    canceled?: boolean
    workbook?: ImportWorkbook
    error?: string
  }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DocumentAPI
  }
}
