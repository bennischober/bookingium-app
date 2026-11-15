import { app, ipcMain, shell } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { container } from 'tsyringe'
import type { EInvoiceCheckDto } from '../api/schemas/invoice.schema'
import { EInvoiceService } from '../services/EInvoiceService'
import { failure, showSaveDialogFor } from './handlerUtils'

/**
 * The print pages' output: the real print (printToPDF) of the window, saved as a PDF with the
 * e-invoice embedded, or an invoice's bare e-invoice XML
 */

// One print job per window at a time: printToPDF fails ("Printing failed")
// while another one runs, e.g. a save or email during the preview
const printQueues = new WeakMap<Electron.WebContents, Promise<unknown>>()

// Only PDFs saved through print:savePdf may be opened via print:openPdf
const savedPdfPaths = new Set<string>()

// A4 with 20mm margins (0.787in), mirroring the sheet padding / @page CSS
function printWindowToPdf(wc: Electron.WebContents): Promise<Buffer> {
  const job = (printQueues.get(wc) ?? Promise.resolve())
    .catch(() => {})
    .then(() =>
      wc.printToPDF({
        landscape: false,
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.787, bottom: 0.787, left: 0.787, right: 0.787 }
      })
    )
  printQueues.set(wc, job)
  return job
}

/**
 * The window's print output; for an invoice with the e-invoice XML embedded
 * when it is complete (ZUGFeRD/Factur-X)
 */
export async function documentPdf(
  wc: Electron.WebContents,
  fileName: string,
  invoiceId?: number
): Promise<{ pdf: Uint8Array; eInvoice?: EInvoiceCheckDto }> {
  const pdf = await printWindowToPdf(wc)
  if (!invoiceId) return { pdf }
  return container.resolve(EInvoiceService).attachToPdf(invoiceId, pdf, fileName)
}

export function registerPrintIpc(): void {
  /** The real print output of the current window, for the print pages' exact preview */
  ipcMain.handle('print:previewPdf', async (event) => {
    try {
      const pdf = await printWindowToPdf(event.sender)
      // Raw bytes (arrive as Uint8Array) — the renderer draws the pages itself
      // with pdf.js; no temp files, no PDF plugin, no data: frames
      return { success: true, data: new Uint8Array(pdf) }
    } catch (error) {
      console.error('Error generating print preview:', error)
      return failure(error)
    }
  })

  /**
   * Saves the real print output of the current window as a PDF, via a save dialog prefilled
   * with the given file name (in Documents). For an invoice, the e-invoice XML is embedded
   * when it is complete (ZUGFeRD/Factur-X); `eInvoice` tells the renderer whether it was.
   */
  ipcMain.handle(
    'print:savePdf',
    async (
      event,
      { defaultFileName, invoiceId }: { defaultFileName: string; invoiceId?: number }
    ) => {
      try {
        const { pdf, eInvoice } = await documentPdf(
          event.sender,
          defaultFileName.replace(/\.pdf$/i, ''),
          invoiceId
        )
        const result = await showSaveDialogFor(event.sender, {
          title: 'Als PDF speichern',
          defaultPath: join(app.getPath('documents'), defaultFileName),
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (result.canceled || !result.filePath) return { success: true, canceled: true }
        await writeFile(result.filePath, pdf)
        savedPdfPaths.add(result.filePath)
        return { success: true, canceled: false, filePath: result.filePath, eInvoice }
      } catch (error) {
        console.error('Error saving PDF:', error)
        return failure(error)
      }
    }
  )

  /**
   * Saves an invoice's e-invoice as a bare XML file (XRechnung for portals of public-sector
   * buyers), via a save dialog
   */
  ipcMain.handle(
    'einvoice:saveXml',
    async (
      event,
      { invoiceId, defaultFileName }: { invoiceId: number; defaultFileName: string }
    ) => {
      try {
        const { xml, ...eInvoice } = await container.resolve(EInvoiceService).check(invoiceId)
        if (!xml) return { success: true, canceled: true, eInvoice }
        const result = await showSaveDialogFor(event.sender, {
          title: 'E-Rechnung als XML speichern',
          defaultPath: join(app.getPath('documents'), defaultFileName),
          filters: [{ name: 'XML', extensions: ['xml'] }]
        })
        if (result.canceled || !result.filePath) return { success: true, canceled: true, eInvoice }
        await writeFile(result.filePath, xml, 'utf-8')
        return { success: true, canceled: false, filePath: result.filePath, eInvoice }
      } catch (error) {
        console.error('Error saving e-invoice XML:', error)
        return failure(error)
      }
    }
  )

  ipcMain.handle('print:openPdf', async (_event, { filePath }: { filePath: string }) => {
    if (!savedPdfPaths.has(filePath)) return { success: false, error: 'Unknown file' }
    const error = await shell.openPath(filePath)
    return error ? { success: false, error } : { success: true }
  })
}
