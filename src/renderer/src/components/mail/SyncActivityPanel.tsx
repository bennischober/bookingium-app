import { useState } from 'react'
import { toast } from '@/lib/toast'
import { AlertTriangle, Copy, EyeOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  passFacts,
  passOutcome,
  passTitle,
  syncActivityReport,
  syncErrorReport,
  syncErrorSeen,
  syncErrorsOf,
  syncErrorText,
  syncErrorWhere
} from './syncActivity'
import type { SyncErrorEntry, SyncStatus } from '../../../../main/mailclient/core/types'

/**
 * #159: the panel behind "Synchronisiert HH:MM" and "· N Fehler": the sync errors still standing,
 * with what can be done about each, and the last passes. Opened from the sync bar; the page runs
 * the actions.
 */
export function SyncActivityPanel({
  open,
  onOpenChange,
  status,
  folderName,
  onRetryFolder,
  onDismiss
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: SyncStatus
  /** the folder's name in the tree, for its IMAP path */
  folderName: (path: string) => string
  /** syncs the folder now; resolves when the core answered */
  onRetryFolder?: (path: string) => Promise<void>
  /** hides the errors by key, all of them with null */
  onDismiss?: (keys: string[] | null) => void
}) {
  const errors = syncErrorsOf(status)
  const passes = status.passHistory ?? (status.lastPass ? [status.lastPass] : [])
  const copy = (text: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success('In die Zwischenablage kopiert'))
      .catch(() => toast.error('Kopieren fehlgeschlagen'))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full overflow-y-auto sm:w-[480px] sm:max-w-[480px]"
        data-testid="mail-sync-panel"
      >
        <SheetHeader>
          <SheetTitle>Synchronisierung</SheetTitle>
          <SheetDescription>
            Was der Abgleich mit dem Server zuletzt getan hat. Nur Zahlen und Ordner, keine Inhalte.
          </SheetDescription>
        </SheetHeader>

        <section className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Fehler</h3>
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => copy(syncActivityReport(status, folderName))}
                title="Fehler und letzte Durchläufe als Text kopieren, etwa für eine Supportanfrage"
              >
                <Copy />
                Alles kopieren
              </Button>
              {errors.length > 0 && onDismiss && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onDismiss(null)}
                  data-testid="mail-sync-errors-dismiss-all"
                >
                  <EyeOff />
                  Alle ausblenden
                </Button>
              )}
            </div>
          </div>
          {errors.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="mail-sync-no-errors">
              Keine Fehler.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {errors.map((entry) => (
                <ErrorRow
                  key={entry.key}
                  entry={entry}
                  folderName={folderName}
                  onCopy={() => copy(syncErrorReport(entry, folderName))}
                  onRetry={entry.path !== null ? onRetryFolder : undefined}
                  onDismiss={onDismiss}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 flex flex-col gap-2">
          <h3 className="text-sm font-medium">Letzte Durchläufe</h3>
          {passes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Seit dem Start noch keiner.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {passes.map((pass) => {
                const outcome = passOutcome(pass)
                return (
                  <li
                    key={`${pass.at}-${pass.kind}`}
                    className="flex flex-col rounded-md border px-3 py-2 text-xs"
                    data-testid="mail-sync-pass"
                    data-trigger={pass.trigger ?? 'user'}
                  >
                    <span className="font-medium text-foreground">
                      {passTitle(pass)}
                      {outcome && (
                        <span
                          className={
                            pass.phase === 'idle'
                              ? ' text-muted-foreground'
                              : ' text-amber-700 dark:text-amber-400'
                          }
                        >
                          {' · '}
                          {outcome}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">{passFacts(pass)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </SheetContent>
    </Sheet>
  )
}

function ErrorRow({
  entry,
  folderName,
  onCopy,
  onRetry,
  onDismiss
}: {
  entry: SyncErrorEntry
  folderName: (path: string) => string
  onCopy: () => void
  onRetry?: (path: string) => Promise<void>
  onDismiss?: (keys: string[] | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(false)
  const german = syncErrorText(entry.message)
  const retry = (path: string) => {
    if (!onRetry) return
    setBusy(true)
    void onRetry(path).finally(() => setBusy(false))
  }
  return (
    <li
      className="flex flex-col gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
      data-testid="mail-sync-error"
      data-path={entry.path ?? ''}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
          <span className="truncate" title={entry.path ?? undefined}>
            {syncErrorWhere(entry, folderName)}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{syncErrorSeen(entry)}</span>
      </div>
      <p className="text-xs">{german ?? entry.message}</p>
      {german &&
        (details ? (
          <p className="font-mono text-[11px] break-words text-muted-foreground">{entry.message}</p>
        ) : (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setDetails(true)}
          >
            Details
          </button>
        ))}
      <div className="flex flex-wrap items-center gap-2">
        {onRetry && entry.path !== null && (
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => retry(entry.path!)}
            data-testid="mail-sync-error-retry"
          >
            <RefreshCw />
            Ordner erneut synchronisieren
          </Button>
        )}
        <Button size="xs" variant="ghost" onClick={onCopy}>
          <Copy />
          Kopieren
        </Button>
        {onDismiss && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onDismiss([entry.key])}
            data-testid="mail-sync-error-dismiss"
          >
            <EyeOff />
            Ausblenden
          </Button>
        )}
        {busy && <Spinner className="size-3.5" />}
      </div>
    </li>
  )
}
