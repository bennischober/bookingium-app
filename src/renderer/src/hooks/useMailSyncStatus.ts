import { useEffect, useEffectEvent, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { mailApi } from '@/lib/mailApi'
import { folderErrorMap } from '@/components/mail/syncActivity'
import { folderLabel } from '@/components/mail/format'
import type { FolderNode } from '../../../main/mailclient/core/types'
import { t } from '../../../main/i18n/translate'

/** #156: how long a folder stays open before it is synced (clicking through starts no sync each) */
const OPEN_SYNC_DELAY_MS = 300

/**
 * The mail page's sync status: polled while something is under way, the opened folder synced
 * after a short delay, and the activity panel's folder names and retry
 */
export function useMailSyncStatus({
  accountId,
  ready,
  folderId,
  allFolders,
  failed
}: {
  accountId: string
  ready: boolean
  folderId: string | null
  allFolders: FolderNode[]
  failed: (title: string) => (error: unknown) => void
}) {
  const syncStatus = useQuery({
    queryKey: ['mail', accountId, 'sync'],
    queryFn: () => mailApi.getSyncStatus(accountId),
    enabled: ready,
    refetchInterval: (data) =>
      data?.running ||
      data?.connection === 'connecting' ||
      data?.connection === 'offline' ||
      // a full disk is a state the user can fix outside the app; keep polling so the bar clears
      // by itself once the retry succeeds, instead of staying stuck until a reload
      data?.diskFull
        ? 2000
        : 10_000
  })

  // #156: the folder the user opens is synced right away, on the sync connection (the core
  // skips it while that folder is being synced anyway; a running pass takes it next). A short
  // delay, so clicking through folders does not start a sync for each one passed over. Quiet on
  // failure: the list shows what is stored, and the sync bar reports connection problems.
  const refetchSyncStatus = useEffectEvent(() => void syncStatus.refetch())
  useEffect(() => {
    if (!ready || !accountId || folderId === null) return
    const timer = setTimeout(() => {
      void mailApi
        .syncOpenedFolder(folderId, accountId)
        .then(refetchSyncStatus)
        .catch(() => undefined)
    }, OPEN_SYNC_DELAY_MS)
    return () => clearTimeout(timer)
  }, [ready, accountId, folderId])
  const loginFailed = syncStatus.data?.connection === 'auth-failed'
  // #159: the folders whose last sync failed, marked in the tree
  const folderSyncErrors = useMemo(() => folderErrorMap(syncStatus.data), [syncStatus.data])
  const folderNameOf = (path: string) => {
    const f = allFolders.find((x) => x.path === path)
    return f ? folderLabel(f) : path
  }
  // #159: "Ordner erneut synchronisieren" in the activity panel, on the sync connection
  const retryFolder = async (path: string) => {
    const f = allFolders.find((x) => x.path === path)
    if (!f) {
      toast.error(t('Den Ordner gibt es nicht mehr'), { description: path })
      return
    }
    try {
      const result = await mailApi.syncOpenedFolder(f.id, accountId)
      if (result === 'synced') toast.success(`${folderLabel(f)} synchronisiert`)
      else if (result === 'queued')
        toast.info(
          t('{{folderLabel}} wird als Nächstes synchronisiert', { folderLabel: folderLabel(f) })
        )
      else if (result === 'skipped')
        toast.warning(t('Gerade nicht möglich'), {
          description: t('Der Ordner wird schon abgeglichen, oder die Verbindung steht nicht.')
        })
      else
        toast.error(t('{{folder}} konnte nicht synchronisiert werden', { folder: folderLabel(f) }))
    } catch (error) {
      failed(t('Synchronisierung fehlgeschlagen'))(error)
    }
    await syncStatus.refetch()
  }

  return { syncStatus, loginFailed, folderSyncErrors, folderNameOf, retryFolder }
}
