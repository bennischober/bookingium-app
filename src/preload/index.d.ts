import { ElectronAPI } from '@electron-toolkit/preload'
import type { ImportWorkbook } from '../main/api/schemas/import.schema'
import type { EInvoiceCheckDto } from '../main/api/schemas/invoice.schema'
import type { MailMethod } from '../main/mail/mailProgram'

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
  /**
   * "Per E-Mail senden": writes the PDF and an email draft and opens it in
   * the mail program; `method` says how (see mail/mailProgram.ts). `kind`
   * reminder/dunning sends a Zahlungserinnerung/Mahnung instead.
   */
  sendInvoiceEmail: (
    invoiceId: number,
    fileName: string,
    lang: 'de' | 'en',
    kind?: 'invoice' | 'reminder' | 'dunning'
  ) => Promise<{
    success: boolean
    method?: MailMethod
    /** The attached PDF, kept in the app's E-Mail folder */
    pdfPath?: string
    /** Recipient address, '' when the recipient has none */
    to?: string
    eInvoice?: EInvoiceCheckDto
    error?: string
  }>
  /** Shows a file of sendInvoiceEmail in Explorer */
  showEmailFile: (filePath: string) => Promise<void>
  /** Opens a mail of the built-in mail client in its own window (or focuses that window) */
  openMailWindow: (accountId: string, messageId: number) => Promise<void>
  /** The draft is stored; close the window main was holding open */
  closeMailWindow: () => void
  /** C1: bookingum's own editor for a prepared draft */
  composeInOwnEditor: (input: {
    accountId: string
    draft: unknown
    pdfPath: string
    pdfName: string
  }) => Promise<{ sent: boolean; messageId?: string }>
  /** C1: the compose window reports a successful send */
  reportComposeSent: (key: string, messageId: string) => Promise<void>
  /** C1: reads the invoice PDF the window was opened with */
  readComposePdf: (filePath: string) => Promise<string>
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
