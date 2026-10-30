import { app } from 'electron'
import { join, resolve } from 'path'
import { mkdir, copyFile, unlink, stat } from 'fs/promises'
import { existsSync } from 'fs'

/**
 * Gets the base directory for storing user data.
 * This is platform-specific:
 * - Windows: C:\Users\<username>\AppData\Roaming\<app-name>
 * - macOS: ~/Library/Application Support/<app-name>
 * - Linux: ~/.config/<app-name>
 * Outside the Electron runtime (tests), falls back to the OS temp directory.
 */
let storageBaseOverride: string | null = null

/** Tests point the storage at a temp folder; null restores the default */
export function setStorageBasePath(path: string | null): void {
  storageBaseOverride = path
}

export function getStorageBasePath(): string {
  if (storageBaseOverride) return storageBaseOverride
  try {
    return join(app.getPath('userData'), 'storage')
  } catch {
    return join(process.env.TMP || process.env.TEMP || '/tmp', 'bookingum-test', 'storage')
  }
}

/**
 * Ensures a directory exists, creating it if necessary.
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true })
  }
}

/**
 * Validates that a file path is safe and within the event directory.
 * Prevents path traversal attacks (e.g., ../../../etc/passwd).
 */
export function validateFilePath(basePath: string, filePath: string): boolean {
  const resolvedBase = resolve(basePath)
  const resolvedFile = resolve(basePath, filePath)

  // Ensure the resolved path is within the base path
  return resolvedFile.startsWith(resolvedBase + (resolvedBase.endsWith(sep()) ? '' : sep()))
}

/**
 * Gets the path separator for the current platform.
 */
function sep(): string {
  return process.platform === 'win32' ? '\\' : '/'
}

/**
 * Gets the full path for a document stored in event storage.
 */
export async function getDocumentFullPath(relativeFilePath: string): Promise<string> {
  const basePath = getStorageBasePath()
  const fullPath = join(basePath, relativeFilePath)

  // Validate the path to prevent path traversal
  if (!validateFilePath(basePath, relativeFilePath)) {
    throw new Error(`Invalid file path: ${relativeFilePath}`)
  }

  return fullPath
}

/**
 * Deletes a document file and optionally validates it exists in event storage.
 */
export async function deleteDocumentFile(relativeFilePath: string): Promise<void> {
  try {
    const fullPath = await getDocumentFullPath(relativeFilePath)

    if (existsSync(fullPath)) {
      await unlink(fullPath)
    }
  } catch (error) {
    console.error(`Failed to delete document file: ${relativeFilePath}`, error)
    throw error
  }
}

/**
 * The absolute path of a stored document, or null when the file is already gone.
 * Used to hand the file to the OS trash instead of deleting it outright.
 */
export async function findDocumentFile(relativeFilePath: string): Promise<string | null> {
  const fullPath = await getDocumentFullPath(relativeFilePath)
  return existsSync(fullPath) ? fullPath : null
}

/**
 * Gets file information (size, exists, etc).
 */
export async function getFileInfo(relativeFilePath: string) {
  try {
    const fullPath = await getDocumentFullPath(relativeFilePath)

    if (!existsSync(fullPath)) {
      return null
    }

    const stats = await stat(fullPath)
    return {
      exists: true,
      size: stats.size,
      isFile: stats.isFile(),
      modified: stats.mtime
    }
  } catch (error) {
    console.error(`Failed to get file info: ${relativeFilePath}`, error)
    return null
  }
}

/**
 * Gets the directory for company logos. Creates it if it doesn't exist.
 */
export async function getCompanyLogoPath(companyId: number): Promise<string> {
  const logoPath = join(getStorageBasePath(), 'logos', String(companyId))
  await ensureDirectoryExists(logoPath)
  return logoPath
}

/**
 * Copies a logo image into the company's logo directory.
 * Returns a relative path that can be stored in the database.
 */
export async function copyLogoToStorage(
  sourcePath: string,
  companyId: number,
  targetFileName: string
): Promise<string> {
  const logoPath = await getCompanyLogoPath(companyId)
  const uniqueFileName = generateUniqueFileName(logoPath, targetFileName)

  await copyFile(sourcePath, join(logoPath, uniqueFileName))

  return join('logos', String(companyId), uniqueFileName)
}

/**
 * Deletes a logo file from company logo storage.
 */
export async function deleteLogoFile(relativeFilePath: string): Promise<void> {
  try {
    const fullPath = await getDocumentFullPath(relativeFilePath)

    if (existsSync(fullPath)) {
      await unlink(fullPath)
    }
  } catch (error) {
    console.error(`Failed to delete logo file: ${relativeFilePath}`, error)
    throw error
  }
}

/**
 * Generates a unique filename by appending a counter if the file already exists.
 */
export function generateUniqueFileName(basePath: string, fileName: string): string {
  const fullPath = join(basePath, fileName)

  if (!existsSync(fullPath)) {
    return fileName
  }

  const ext = fileName.lastIndexOf('.')
  const nameWithoutExt = fileName.slice(0, ext)
  const extension = fileName.slice(ext)

  let counter = 1
  while (existsSync(join(basePath, `${nameWithoutExt}_${counter}${extension}`))) {
    counter++
  }

  return `${nameWithoutExt}_${counter}${extension}`
}
