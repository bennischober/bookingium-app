import { join } from 'path'
import { stat, writeFile } from 'fs/promises'
import { ensureDirectoryExists, generateUniqueFileName, getStorageBasePath } from './fileStorage'

// #225: receipt files live in storage/receipts/<YYYY-MM>/ by receipt date ("ohne-datum" when it
// is unknown). The folder never changes afterwards; renaming a receipt changes only the name
// DATEV is shown (receipt.file_name), not the stored file.

export const RECEIPTS_DIR = 'receipts'

/** Writes the bytes and returns the path relative to the storage folder */
export async function storeReceiptFile(
  bytes: Uint8Array,
  fileName: string,
  receiptDate: string | null
): Promise<{ relativePath: string; fileSize: number }> {
  const month =
    receiptDate && /^\d{4}-\d{2}/.test(receiptDate) ? receiptDate.slice(0, 7) : 'ohne-datum'
  const folder = join(RECEIPTS_DIR, month)
  const fullFolder = join(getStorageBasePath(), folder)
  await ensureDirectoryExists(fullFolder)
  const unique = generateUniqueFileName(fullFolder, fileName)
  await writeFile(join(fullFolder, unique), Buffer.from(bytes))
  const { size } = await stat(join(fullFolder, unique))
  return { relativePath: join(folder, unique), fileSize: Math.max(size, 1) }
}
