// A computer that is not syncing yet looks for a sync group in the cloud folders it has
// (OneDrive, Google Drive, Dropbox), so joining is one click instead of searching the folder.
// No Electron: the caller passes the environment and the home folder.

import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { GROUP_FILE } from './transport'

/** The cloud folders of this computer: OneDrive (personal and work), Google Drive, Dropbox */
export function cloudRoots(env: Record<string, string | undefined>, home: string): string[] {
  const roots = [
    env.OneDrive,
    env.OneDriveConsumer,
    env.OneDriveCommercial,
    join(home, 'OneDrive'),
    join(home, 'Google Drive'),
    join(home, 'Google Drive', 'Meine Ablage'),
    join(home, 'Google Drive', 'My Drive'),
    'G:\\Meine Ablage',
    'G:\\My Drive',
    join(home, 'Dropbox')
  ].filter((root): root is string => Boolean(root))
  return [...new Set(roots.map((root) => root.replace(/[\\/]+$/, '')))]
}

async function isGroup(folder: string): Promise<boolean> {
  try {
    const group = JSON.parse(await readFile(join(folder, GROUP_FILE), 'utf-8')) as { app?: string }
    return group.app === 'bookingium'
  } catch {
    return false
  }
}

async function subfolders(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(folder, entry.name))
  } catch {
    return []
  }
}

/**
 * Sync groups in the cloud roots, at most two levels deep (OneDrive\Bookingium,
 * OneDrive\Dokumente\Bookingium); a root itself counts too. Unreadable folders are skipped.
 */
export async function findSyncFolders(roots: string[], maxDepth = 2): Promise<string[]> {
  const found = new Set<string>()
  const visit = async (folder: string, depth: number): Promise<void> => {
    if (await isGroup(folder)) {
      found.add(folder)
      return
    }
    if (depth >= maxDepth) return
    for (const child of await subfolders(folder)) await visit(child, depth + 1)
  }
  for (const root of roots) await visit(root, 0)
  return [...found]
}
