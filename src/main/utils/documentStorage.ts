import { basename, join } from 'path'
import { copyFile, readdir, rename, rm, rmdir, stat, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import type { DocumentOwnerType } from '../api/schemas/document.schema'
import {
  ensureDirectoryExists,
  generateUniqueFileName,
  getDocumentFullPath,
  getStorageBasePath
} from './fileStorage'

// ========================================
// Document folders
// ========================================
// storage/
//   documents/
//     events/12-2026-06-11-muenchen-the-new-roses/vertrag.pdf
//     bands/3-pretty-wild/rider.pdf
//     companies/5-brainstorm-music-marketing-ag/...
//     venues/…, persons/…
//   logos/<companyId>/…
// One folder per record: "<id>-<readable name>". The id keeps it unique and
// stable; renaming a record keeps its existing folder.

export const DOCUMENTS_DIR = 'documents'

const OWNER_DIRS: Record<DocumentOwnerType, string> = {
  event: 'events',
  band: 'bands',
  company: 'companies',
  venue: 'venues',
  person: 'persons'
}

const TRANSLITERATION: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

/** "Pretty Wild – München!" → "pretty-wild-muenchen" */
export function slugify(text: string, maxLength = 60): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => TRANSLITERATION[char])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '')
}

function ownerTypeDir(ownerType: DocumentOwnerType): string {
  return join(getStorageBasePath(), DOCUMENTS_DIR, OWNER_DIRS[ownerType])
}

async function findOwnerFolder(
  ownerType: DocumentOwnerType,
  ownerId: number
): Promise<string | null> {
  const typeDir = ownerTypeDir(ownerType)
  if (!existsSync(typeDir)) return null
  const entries = await readdir(typeDir, { withFileTypes: true })
  const match = entries.find(
    (entry) =>
      entry.isDirectory() &&
      (entry.name === String(ownerId) || entry.name.startsWith(`${ownerId}-`))
  )
  return match ? match.name : null
}

/**
 * The owner's folder relative to the storage folder (created if missing);
 * an existing folder of that id is reused even if the name changed since
 */
export async function ensureOwnerFolder(
  ownerType: DocumentOwnerType,
  ownerId: number,
  label: string
): Promise<string> {
  const existing = await findOwnerFolder(ownerType, ownerId)
  const slug = slugify(label)
  const name = existing ?? (slug ? `${ownerId}-${slug}` : String(ownerId))
  const relative = join(DOCUMENTS_DIR, OWNER_DIRS[ownerType], name)
  await ensureDirectoryExists(join(getStorageBasePath(), relative))
  return relative
}

/** Copies a file into the owner's folder; returns its relative path and size */
export async function storeOwnerFile(
  sourcePath: string,
  ownerType: DocumentOwnerType,
  ownerId: number,
  ownerLabel: string,
  fileName: string
): Promise<{ relativePath: string; fileName: string; fileSize: number }> {
  const folder = await ensureOwnerFolder(ownerType, ownerId, ownerLabel)
  const fullFolder = join(getStorageBasePath(), folder)
  const uniqueName = generateUniqueFileName(fullFolder, fileName)
  await copyFile(sourcePath, join(fullFolder, uniqueName))
  const { size } = await stat(join(fullFolder, uniqueName))
  return { relativePath: join(folder, uniqueName), fileName: uniqueName, fileSize: size }
}

/**
 * Moves a stored file into the owner's folder (for files from the old
 * storage/events/<id>/ layout); returns the new relative path
 */
export async function moveIntoOwnerFolder(
  relativePath: string,
  ownerType: DocumentOwnerType,
  ownerId: number,
  ownerLabel: string
): Promise<string> {
  const source = await getDocumentFullPath(relativePath)
  const folder = await ensureOwnerFolder(ownerType, ownerId, ownerLabel)
  const fullFolder = join(getStorageBasePath(), folder)
  const fileName = generateUniqueFileName(fullFolder, basename(relativePath))
  const target = join(fullFolder, fileName)
  try {
    await rename(source, target)
  } catch {
    // Different drive or locked: copy, then remove the original
    await copyFile(source, target)
    await unlink(source)
  }
  return join(folder, fileName)
}

/** Removes an owner's folder with all its files (after the owner was deleted) */
export async function removeOwnerFolder(
  ownerType: DocumentOwnerType,
  ownerId: number
): Promise<void> {
  const folder = await findOwnerFolder(ownerType, ownerId)
  if (folder) await rm(join(ownerTypeDir(ownerType), folder), { recursive: true, force: true })
}

/** Deletes a folder if it is empty (old layout leftovers) */
export async function removeIfEmpty(relativeFolder: string): Promise<void> {
  const full = join(getStorageBasePath(), relativeFolder)
  if (existsSync(full) && (await readdir(full)).length === 0) await rmdir(full)
}

/** Whether a stored path already follows the documents/<type>/<folder>/ layout */
export function isInDocumentsLayout(relativePath: string): boolean {
  // Stored paths use the separator of the OS they were saved on
  return relativePath.split(/[\\/]/)[0] === DOCUMENTS_DIR
}

/** Absolute path of an owner's folder (created if missing), for "Ordner öffnen" */
export async function ownerFolderFullPath(
  ownerType: DocumentOwnerType,
  ownerId: number,
  label: string
): Promise<string> {
  return join(getStorageBasePath(), await ensureOwnerFolder(ownerType, ownerId, label))
}
