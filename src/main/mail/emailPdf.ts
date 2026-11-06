// #136: the PDF an invoice or contract mail attaches. bookingum's compose window is the
// only way such a mail is sent, and main attaches the file when the window sends (see
// invoiceSend.ts), so it is written to <userData>/E-Mail first. Files older than 30 days
// are removed.
import { app } from 'electron'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { safeAttachmentName, safePathIn } from '../mailclient/attachments'

const KEEP_DAYS = 30

async function removeOldFiles(folder: string): Promise<void> {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const name of await readdir(folder)) {
    const path = join(folder, name)
    try {
      if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true })
    } catch {
      // In use or gone: try again next time
    }
  }
}

/** Writes the PDF for a compose window and returns its path */
export async function saveEmailPdf({
  pdf,
  fileName,
  fallbackName = 'Rechnung'
}: {
  pdf: Uint8Array
  fileName: string
  /** The file's name when `fileName` has nothing usable left */
  fallbackName?: string
}): Promise<string> {
  const folder = join(app.getPath('userData'), 'E-Mail')
  await mkdir(folder, { recursive: true })
  await removeOldFiles(folder)
  // I11 (MR-34): the name comes from the renderer, so it is flattened and kept inside the folder
  const pdfPath = safePathIn(folder, `${safeAttachmentName(fileName, fallbackName)}.pdf`)
  await writeFile(pdfPath, pdf)
  return pdfPath
}
