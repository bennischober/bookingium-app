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
 */
export function getStorageBasePath(): string {
  return join(app.getPath('userData'), 'storage')
}

/**
 * Gets the directory for a specific event's documents.
 * Creates the directory if it doesn't exist.
 */
export async function getEventStoragePath(eventId: number): Promise<string> {
  const eventPath = join(getStorageBasePath(), 'events', String(eventId))
  await ensureDirectoryExists(eventPath)
  return eventPath
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
 * Copies a file from source to the event's storage directory.
 * Returns a relative path that can be stored in the database.
 */
export async function copyFileToEventStorage(
  sourcePath: string,
  eventId: number,
  targetFileName: string
): Promise<string> {
  const eventPath = await getEventStoragePath(eventId)
  const targetPath = join(eventPath, targetFileName)

  await copyFile(sourcePath, targetPath)

  // Return a relative path for storage in the database
  return join('events', String(eventId), targetFileName)
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
