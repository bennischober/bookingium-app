import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { toast } from 'sonner'
import { mailApi } from '@/lib/mailApi'
import { confirmAction } from '@/lib/confirm'
import { askFolderName } from '@/lib/folderName'
import type { FolderAction } from '@/components/mail/FolderTree'
import { folderLabel, isInbox } from '@/components/mail/format'
import type { FolderNode } from '../../../main/mailclient/core/types'

/** R4: the mail page's folder actions - create, rename, delete - and moving a folder by drag */
export function useFolderActions({
  accountId,
  folders,
  refreshLists,
  failed
}: {
  accountId: string
  folders: UseQueryResult<FolderNode[]>
  refreshLists: () => void
  failed: (title: string) => (error: unknown) => void
}) {
  // B2: the folder being dragged, so a drop knows what to move
  const [movingFolder, setMovingFolder] = useState<FolderNode | null>(null)
  /**
   * B2: move the dragged folder under `target` (null = top level). The core
   * refuses a move into itself or its own subtree and a name clash there.
   */
  const moveFolderTo = async (target: FolderNode | null) => {
    const folder = movingFolder
    setMovingFolder(null)
    if (!folder) return
    try {
      await mailApi.moveFolder(folder.path, target?.path ?? null, accountId)
      await folders.refetch()
      toast.success(
        target
          ? `„${folderLabel(folder)}“ nach „${folderLabel(target)}“ verschoben`
          : `„${folderLabel(folder)}“ nach oben verschoben`
      )
    } catch (error) {
      toast.error('Ordner konnte nicht verschoben werden', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  // B1: create / rename / delete a folder. The name is asked for in a small
  // dialog; the core validates it again and refuses protected folders.
  const folderAction = async (action: FolderAction, folder: FolderNode | null) => {
    // "Neuer Ordner…" on INBOX means top level, not inside INBOX: IMAP has no
    // subfolders of INBOX, and the card's path builder puts a child under its parent.
    const delimiter = folder?.delimiter ?? '/'
    const parentPath = action !== 'create' ? null : !folder || isInbox(folder) ? null : folder.path
    const title =
      action === 'create'
        ? parentPath
          ? `Neuer Ordner in „${folderLabel(folder!)}“`
          : 'Neuer Ordner'
        : action === 'rename'
          ? 'Ordner umbenennen'
          : 'Ordner löschen'
    const current = action === 'rename' && folder ? folder.path.split(delimiter).pop() : ''
    if (action === 'delete') {
      if (!folder) return
      const confirmed = await confirmAction({
        title: `„${folderLabel(folder) || folder.name}“ löschen?`,
        description:
          'Der Ordner wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
      if (!confirmed) return
      try {
        await mailApi.deleteFolder(folder.path, accountId)
      } catch (error) {
        failed('Ordner konnte nicht gelöscht werden')(error)
        return
      }
      refreshLists()
      toast.success('Ordner gelöscht')
      return
    }
    const name = await askFolderName({ title, initial: current })
    if (name === null) return
    try {
      if (action === 'create') await mailApi.createFolder(parentPath, name, accountId)
      else if (folder) await mailApi.renameFolder(folder.path, name, accountId)
    } catch (error) {
      failed(
        action === 'create'
          ? 'Ordner konnte nicht angelegt werden'
          : 'Ordner konnte nicht umbenannt werden'
      )(error)
      return
    }
    refreshLists()
    toast.success(action === 'create' ? 'Ordner angelegt' : 'Ordner umbenannt')
  }

  return { movingFolder, setMovingFolder, moveFolderTo, folderAction }
}
