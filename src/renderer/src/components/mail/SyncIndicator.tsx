import { useEffect, useState } from 'react'
import { HardDrive, Pause, Play, RefreshCw, WifiOff } from 'lucide-react'
import { retryIn } from '@/lib/mailConnection'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { runningOpLabel } from '@/components/mail/opLabel'
import { passSummaryText, syncProgressText } from '@/components/mail/syncProgress'
import { syncErrorsOf } from '@/components/mail/syncActivity'
import { SyncActivityPanel } from '@/components/mail/SyncActivityPanel'
import type { SyncStatus } from '../../../../main/mailclient/core/types'

/** The current time, updated every second while `active` (for countdowns) */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    // `now` may be old when the countdown starts
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [active])
  return now
}

export function SyncIndicator({
  status,
  runningOp,
  onPause,
  onResume,
  onSync,
  onSyncAll,
  folderName = (path) => path,
  onRetryFolder,
  onDismissErrors
}: {
  status: SyncStatus | undefined
  runningOp: string | null
  onPause: () => void
  onResume: () => void
  /** #156: the open folder, INBOX, Sent, Drafts, Trash and every folder whose STATUS changed */
  onSync: () => void
  /** #156: the deep check, every folder opened and compared */
  onSyncAll: () => void
  /** #159: the folder's name in the tree, for the activity panel */
  folderName?: (path: string) => string
  /** #159: "Ordner erneut synchronisieren" in the activity panel */
  onRetryFolder?: (path: string) => Promise<void>
  /** #159: "Ausblenden" in the activity panel; null hides all */
  onDismissErrors?: (keys: string[] | null) => void
}) {
  const offline = status?.connection === 'offline' && !status.running
  const now = useNow(offline && Boolean(status?.retryAt))
  // #159: the activity panel behind the sync time and the error count
  const [panelOpen, setPanelOpen] = useState(false)
  // A running write op needs no sync status to be worth showing
  const label = runningOpLabel(runningOp)

  // H2/G3: no status yet means the worker is still starting (syncStatus is gated on it), which
  // is exactly when a silent bar is least useful. Say so instead of rendering nothing - an
  // absent bar reads as "this feature does not exist".
  if (!status) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
        <Spinner className="size-3" />
        <span>{label ?? 'Startet…'}</span>
      </div>
    )
  }
  // A full disk is NOT a connection problem, so this branch comes before `offline`: telling the
  // user to check their network when the drive is full is the exact confusion this state exists
  // to prevent. The retry clears it in the core (resumeSync), then a pass downloads again.
  if (status.diskFull) {
    return (
      <div
        className="flex items-center gap-1 text-xs text-destructive"
        aria-live="polite"
        title={status.diskFull}
        data-testid="mail-disk-full"
      >
        <HardDrive className="size-3.5" />
        <span>Speicherplatz voll</span>
        <Button variant="ghost" size="icon-xs" onClick={onResume} title="Erneut versuchen">
          <RefreshCw />
        </Button>
      </div>
    )
  }
  // The banner below the header explains this one
  if (status.connection === 'auth-failed') {
    return (
      <div className="text-xs text-destructive" aria-live="polite">
        Anmeldung fehlgeschlagen
      </div>
    )
  }
  // #159: the errors still standing, not only the last pass's; a click opens the panel
  const errorCount = syncErrorsOf(status).length
  const errorsButton =
    errorCount > 0 ? (
      <button
        type="button"
        className="text-destructive hover:underline"
        onClick={() => setPanelOpen(true)}
        title="Fehler und letzte Durchläufe anzeigen"
        data-testid="mail-sync-errors"
      >
        · {errorCount} Fehler
      </button>
    ) : null
  const panel = (
    <SyncActivityPanel
      open={panelOpen}
      onOpenChange={setPanelOpen}
      status={status}
      folderName={folderName}
      onRetryFolder={onRetryFolder}
      onDismiss={onDismissErrors}
    />
  )
  if (offline) {
    const due = status.retryAt ? new Date(status.retryAt).getTime() <= now : false
    return (
      <div
        className="flex items-center gap-1 text-xs text-muted-foreground"
        aria-live="polite"
        title={status.connectionError ?? undefined}
        data-testid="mail-offline"
      >
        <WifiOff className="size-3.5" />
        <span>
          Offline
          {status.retryAt &&
            (due ? ' · verbinde…' : ` · nächster Versuch ${retryIn(status.retryAt, now)}`)}
        </span>
        <Button variant="ghost" size="icon-xs" onClick={onSync} title="Jetzt verbinden">
          <RefreshCw />
        </Button>
        {errorsButton}
        {panel}
      </div>
    )
  }
  const initial = status.phase === 'initial' || status.phase === 'paused'
  const progress = syncProgressText(status)

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
      {/* H2: a running write op wins over the sync text - it is what the user just
          started, and it finishes in seconds */}
      {label ? (
        <>
          <Spinner className="size-3" />
          <span>{label}</span>
        </>
      ) : status.paused && status.spaceWarning ? (
        // #63: held before the first download; the banner says why and how much
        <span
          className="flex items-center gap-1 text-amber-700 dark:text-amber-400"
          title={status.spaceWarning}
          data-testid="mail-space-warning"
        >
          <HardDrive className="size-3.5" />
          <span>Wenig Speicherplatz · {progress}</span>
          <Button variant="ghost" size="icon-xs" onClick={onResume} title="Trotzdem fortsetzen">
            <Play />
          </Button>
        </span>
      ) : status.paused ? (
        <>
          <span>Download pausiert · {progress}</span>
          <Button variant="ghost" size="icon-xs" onClick={onResume} title="Fortsetzen">
            <Play />
          </Button>
        </>
      ) : status.running ? (
        <>
          <Spinner className="size-3" />
          <span>
            {status.connection === 'connecting' ? 'Verbinde…' : `Synchronisiere · ${progress}`}
          </span>
          {initial && (
            <Button variant="ghost" size="icon-xs" onClick={onPause} title="Pausieren">
              <Pause />
            </Button>
          )}
        </>
      ) : (
        <>
          {/* #156: what the last pass the user started did, counts only (pacing checks);
              #159: a click opens the activity panel */}
          <button
            type="button"
            className="hover:text-foreground hover:underline"
            onClick={() => setPanelOpen(true)}
            title={
              status.lastPass
                ? `${passSummaryText(status.lastPass)}\n\nKlicken für die letzten Durchläufe`
                : 'Klicken für die letzten Durchläufe'
            }
            data-testid="mail-sync-time"
          >
            {status.lastSyncAt
              ? `Synchronisiert ${new Date(status.lastSyncAt).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}`
              : 'Noch nicht synchronisiert'}
          </button>
          {/* F14: the mailbox updates by itself (IDLE on INBOX, plus a poll), so the
              button is an extra, not the only way to get new mail */}
          <span
            className="text-muted-foreground"
            title={
              status.idleConnected
                ? 'Neue E-Mail im Posteingang kommt von selbst an. Andere Ordner werden regelmäßig abgeglichen.'
                : 'Der Posteingang wird regelmäßig abgeglichen.'
            }
          >
            {status.idleConnected ? '· automatisch' : '· regelmäßig'}
          </span>
          {/* #156: two visible actions. "Synchronisieren" is the fast pass (the important
              folders and whatever STATUS says changed); "Alle Ordner prüfen" opens every folder */}
          <Button
            variant="outline"
            size="xs"
            onClick={onSync}
            title="Gleicht den geöffneten Ordner, Posteingang, Gesendet, Entwürfe und Papierkorb ab, dazu jeden Ordner, der sich auf dem Server geändert hat."
            data-testid="mail-sync"
          >
            <RefreshCw />
            Synchronisieren
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={onSyncAll}
            title="Öffnet und vergleicht jeden Ordner, auch gelesene und markierte E-Mails. Dauert bei einem großen Postfach einige Minuten."
            data-testid="mail-sync-all"
          >
            Alle Ordner prüfen
          </Button>
        </>
      )}
      {errorsButton}
      {panel}
    </div>
  )
}
