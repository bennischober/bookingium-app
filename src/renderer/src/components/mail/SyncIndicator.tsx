import { useEffect, useState } from 'react'
import { HardDrive, Pause, Play, RefreshCw, WifiOff } from 'lucide-react'
import { retryIn } from '@/lib/mailConnection'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { runningOpLabel } from '@/components/mail/opLabel'
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
  onSync
}: {
  status: SyncStatus | undefined
  runningOp: string | null
  onPause: () => void
  onResume: () => void
  onSync: () => void
}) {
  const offline = status?.connection === 'offline' && !status.running
  const now = useNow(offline && Boolean(status?.retryAt))
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
      </div>
    )
  }
  const initial = status.phase === 'initial' || status.phase === 'paused'
  const progress =
    initial && status.messagesDone !== undefined
      ? `${status.messagesDone.toLocaleString('de-DE')}${
          status.messagesTotal ? ` / ${status.messagesTotal.toLocaleString('de-DE')}` : ''
        } E-Mails`
      : `${status.foldersSynced} / ${status.foldersTotal} Ordner`

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
      {/* H2: a running write op wins over the sync text - it is what the user just
          started, and it finishes in seconds */}
      {label ? (
        <>
          <Spinner className="size-3" />
          <span>{label}</span>
        </>
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
          <span>
            {status.lastSyncAt
              ? `Synchronisiert ${new Date(status.lastSyncAt).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}`
              : 'Noch nicht synchronisiert'}
          </span>
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
          <Button variant="ghost" size="icon-xs" onClick={onSync} title="Jetzt synchronisieren">
            <RefreshCw />
          </Button>
        </>
      )}
      {status.errors.length > 0 && (
        <span className="text-destructive" title={status.errors.join('\n')}>
          · {status.errors.length} Fehler
        </span>
      )}
    </div>
  )
}
