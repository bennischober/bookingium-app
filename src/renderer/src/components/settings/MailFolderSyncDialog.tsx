import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { mailApi } from '@/lib/mailApi'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { flattenFolders, folderLabel } from '@/components/mail/format'
import { syncModeRows } from '@/components/settings/mailFolderSync'
import type { FolderNode, FolderSyncMode } from '../../../../main/mailclient/core/types'

/**
 * #158: which folders of an account sync always ("ausgewählt") and which only when they are
 * opened. A local setting: the subscriptions on the server stay as they are.
 */
export function MailFolderSyncDialog({
  accountId,
  email,
  open,
  onOpenChange
}: {
  accountId: string
  email: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  // the mail page's own query, so the tree there shows a change at once
  const folders = useQuery({
    queryKey: ['mail', accountId, 'folders'],
    queryFn: () => mailApi.getFolders(accountId),
    enabled: open
  })
  const all = flattenFolders(folders.data ?? [])
  const rows = syncModeRows(all, filter)
  const knowsSubscriptions = all.some((f) => f.subscribed !== null)

  const run = async (task: () => Promise<number>, done: (changed: number) => string) => {
    setBusy(true)
    try {
      const changed = await task()
      await queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'folders'] })
      toast.success(done(changed))
    } catch (error) {
      toast.error('Einstellung konnte nicht gespeichert werden', {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setBusy(false)
    }
  }
  const setMode = (list: FolderNode[], mode: FolderSyncMode) =>
    run(
      () =>
        mailApi.setFolderSyncMode(
          list.map((f) => f.id),
          mode,
          accountId
        ),
      (changed) => (changed === 1 ? '1 Ordner geändert' : `${changed} Ordner geändert`)
    )
  const adopt = () =>
    run(
      () => mailApi.adoptSubscriptions(accountId),
      (changed) =>
        changed === 0
          ? 'Die Auswahl entspricht schon den Abonnements'
          : changed === 1
            ? 'Abonnements übernommen: 1 Ordner geändert'
            : `Abonnements übernommen: ${changed} Ordner geändert`
    )
  const switchable = rows.filter((r) => !r.fixed).map((r) => r.folder)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ordner auswählen</DialogTitle>
          <DialogDescription>
            {email}: Ausgewählte Ordner werden immer synchronisiert, die anderen nur beim Öffnen.
            Posteingang, Gesendet, Entwürfe, Papierkorb, Archiv und Spam werden immer
            synchronisiert. Die Abonnements auf dem Server bleiben unverändert.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Ordner filtern"
          aria-label="Ordner filtern"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || switchable.length === 0}
            onClick={() => void setMode(switchable, 'always')}
          >
            Angezeigte auswählen
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || switchable.length === 0}
            onClick={() => void setMode(switchable, 'on_open')}
          >
            Angezeigte abwählen
          </Button>
        </div>
        {folders.isLoading ? (
          <Spinner className="m-2" />
        ) : folders.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Die Ordner konnten nicht geladen werden.
          </p>
        ) : (
          <ul
            className="max-h-80 divide-y overflow-auto rounded-md border"
            aria-label="Ordner"
            data-testid="mail-folder-sync-list"
          >
            {rows.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">Kein Ordner gefunden.</li>
            )}
            {rows.map(({ folder, fixed, path }) => (
              <li key={folder.id}>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={fixed || folder.syncMode === 'always'}
                    disabled={fixed || busy}
                    onChange={(e) =>
                      void setMode([folder], e.target.checked ? 'always' : 'on_open')
                    }
                  />
                  <span className="min-w-0 flex-1 truncate" title={folder.path}>
                    {fixed ? folderLabel(folder) : path}
                  </span>
                  {folder.subscribed === false && (
                    <span className="shrink-0 text-xs text-muted-foreground">nicht abonniert</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={busy || !knowsSubscriptions}
            title={
              knowsSubscriptions
                ? 'Abonnierte Ordner werden immer synchronisiert, die anderen nur beim Öffnen'
                : 'Der Server hat keine Abonnements gemeldet'
            }
            onClick={() => void adopt()}
          >
            Abonnierte Ordner übernehmen
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Fertig
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
