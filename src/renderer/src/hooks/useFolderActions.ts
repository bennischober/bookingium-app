import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { mailApi } from '@/lib/mailApi'
import { confirmAction } from '@/lib/confirm'
import { askFolderName } from '@/lib/folderName'
import type { FolderAction } from '@/components/mail/FolderTree'
import { folderLabel, isInbox } from '@/components/mail/format'
import type { FolderNode, FolderSyncMode } from '../../../main/mailclient/core/types'
import { t } from '../../../main/i18n/translate'

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
          ? t('„{{folderLabel}}“ nach „{{folderLabel2}}“ verschoben', {
              folderLabel: folderLabel(folder),
              folderLabel2: folderLabel(target)
            })
          : t('„{{folderLabel}}“ nach oben verschoben', { folderLabel: folderLabel(folder) })
      )
    } catch (error) {
      toast.error(t('Ordner konnte nicht verschoben werden'), {
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
          ? t('Neuer Ordner in „{{folderLabel}}“', { folderLabel: folderLabel(folder!) })
          : t('Neuer Ordner')
        : action === 'rename'
          ? t('Ordner umbenennen')
          : t('Ordner löschen')
    const current = action === 'rename' && folder ? folder.path.split(delimiter).pop() : ''
    if (action === 'delete') {
      if (!folder) return
      const confirmed = await confirmAction({
        title: t('„{{value}}“ löschen?', { value: folderLabel(folder) || folder.name }),
        description: t(
          'Der Ordner wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.'
        ),
        confirmLabel: t('Löschen'),
        destructive: true
      })
      if (!confirmed) return
      try {
        await mailApi.deleteFolder(folder.path, accountId)
      } catch (error) {
        failed(t('Ordner konnte nicht gelöscht werden'))(error)
        return
      }
      refreshLists()
      toast.success(t('Ordner gelöscht'))
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
          ? t('Ordner konnte nicht angelegt werden')
          : t('Ordner konnte nicht umbenannt werden')
      )(error)
      return
    }
    refreshLists()
    toast.success(action === 'create' ? t('Ordner angelegt') : t('Ordner umbenannt'))
  }

  /** #158: the folder's sync setting; switching to "always" downloads a never-opened folder */
  const setSyncMode = async (folder: FolderNode, mode: FolderSyncMode) => {
    try {
      await mailApi.setFolderSyncMode([folder.id], mode, accountId)
    } catch (error) {
      failed(t('Einstellung konnte nicht gespeichert werden'))(error)
      return
    }
    await folders.refetch()
    toast.success(
      mode === 'always'
        ? t('„{{folderLabel}}“ wird immer synchronisiert', { folderLabel: folderLabel(folder) })
        : t('„{{folderLabel}}“ wird nur beim Öffnen synchronisiert', {
            folderLabel: folderLabel(folder)
          })
    )
  }

  return { movingFolder, setMovingFolder, moveFolderTo, folderAction, setSyncMode }
}
