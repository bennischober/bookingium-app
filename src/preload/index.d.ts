import type { ImportFile } from '../main/api/schemas/import.schema'
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
  /**
   * "Per E-Mail senden": writes the PDF and opens bookingum's compose window with the
   * filled template on the "Senden von" account (#136); resolves once that window is
   * closed. `kind` reminder/dunning sends a Zahlungserinnerung/Mahnung instead.
   */
  sendInvoiceEmail: (
    invoiceId: number,
    fileName: string,
    lang: 'de' | 'en',
    kind?: 'invoice' | 'reminder' | 'dunning'
  ) => Promise<{
    success: boolean
    /** The mail was sent from the compose window (false: closed without sending) */
    sent?: boolean
    eInvoice?: EInvoiceCheckDto
    error?: string
    /** The error is fixed in Einstellungen › E-Mail (no account, or none that can send) */
    setup?: boolean
  }>
  /**
   * #120: email a concert contract (by its deal memo id) or a management contract (by its
   * id) as the PDF of this window, from the "Vertrag" template
   */
  sendContractEmail: (
    contract: 'concert' | 'management',
    id: number,
    fileName: string,
    lang: 'de' | 'en'
  ) => Promise<{
    success: boolean
    sent?: boolean
    error?: string
    setup?: boolean
  }>
  /** Copy a mail's link address; the main process holds the clipboard and re-checks the scheme */
  copyMailLink: (url: string) => Promise<{ success: boolean; error?: string }>
  /** Opens a mail of the built-in mail client in its own window (or focuses that window) */
  openMailWindow: (accountId: string, messageId: number) => Promise<void>
  /** The draft is stored; close the window main was holding open */
  closeMailWindow: () => void
  /** Open dialog for a CSV file; returns its rows for the import dialog */
  pickImportFile: () => Promise<{
    success: boolean
    canceled?: boolean
    file?: ImportFile
    error?: string
  }>
  /** An error nothing caught, for the local error log (main scrubs it) */
  reportError: (report: { message: string; stack?: string }) => void
  /** New mail while the main window has focus: the popup's text (count and account only) */
  onNewMail: (
    callback: (notice: { title: string; body: string; accountId: string }) => void
  ) => () => void
  /**
   * The tray or a new-mail notification asks for the mail page, a notification with its
   * account; returns the unsubscribe
   */
  onOpenMailPage: (callback: (accountId?: string) => void) => () => void
  /**
   * #142: a reminder while the main window has focus: the popup's text (counts only); #71: `day`
   * for an appointment's, the calendar opens on it
   */
  onReminder: (
    callback: (notice: { title: string; body: string; day?: string }) => void
  ) => () => void
  /** #142: a click on a reminder notification asks for the dashboard; returns the unsubscribe */
  onOpenDashboard: (callback: () => void) => () => void
  /** #71: a click on an appointment's reminder asks for its day (YYYY-MM-DD) in the calendar */
  onOpenCalendar: (callback: (day: string) => void) => () => void
}

declare global {
  interface Window {
    api: DocumentAPI
  }
}
