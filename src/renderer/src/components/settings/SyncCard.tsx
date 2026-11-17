import { AlertTriangle, FolderOpen, Monitor, RefreshCw } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { SyncFolderDto, SyncStatusDto } from '../../../../main/api/schemas/sync.schema'

/** "28.10.2026, 14:30" */
const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

function SyncState({ status }: { status: SyncStatusDto }) {
  if (status.running) return <p className="text-sm text-muted-foreground">Wird abgeglichen…</p>
  return (
    <div className="space-y-1 text-sm">
      {status.lastError ? (
        <p className="text-destructive">
          Abgleich fehlgeschlagen
          {status.lastRunAt ? ` (${formatDateTime(status.lastRunAt)})` : ''}: {status.lastError}
        </p>
      ) : (
        <p className="text-muted-foreground">
          {status.lastSuccessAt
            ? `Zuletzt abgeglichen: ${formatDateTime(status.lastSuccessAt)}`
            : 'Noch nicht abgeglichen.'}
        </p>
      )}
      {status.lastError && status.lastSuccessAt && (
        <p className="text-muted-foreground">
          Zuletzt erfolgreich: {formatDateTime(status.lastSuccessAt)}
        </p>
      )}
      {status.pendingChanges > 0 && (
        <p className="text-muted-foreground">
          {status.pendingChanges === 1
            ? '1 Änderung dieses Computers wartet auf den nächsten Abgleich.'
            : `${status.pendingChanges} Änderungen dieses Computers warten auf den nächsten Abgleich.`}
        </p>
      )}
      {status.waitingFiles > 0 && (
        <p className="text-muted-foreground">
          {status.waitingFiles === 1 ? '1 Dokument' : `${status.waitingFiles} Dokumente`} vom
          anderen Computer {status.waitingFiles === 1 ? 'ist' : 'sind'} noch nicht im Ordner
          angekommen.
        </p>
      )}
      {status.newerVersionElsewhere && (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Ein anderer Computer hat eine neuere Version von Bookingium. Seine Änderungen kommen an,
          sobald Bookingium auf diesem Computer aktualisiert ist; das Update wird schon gesucht
          (siehe „Version und Updates“).
        </p>
      )}
      {status.reidentifiedAt && (
        <p className="text-muted-foreground">
          Seit dem Wiederherstellen einer Sicherung ({formatDateTime(status.reidentifiedAt)}) holt
          dieser Computer die neueren Änderungen der anderen wieder herein.
        </p>
      )}
    </div>
  )
}

/**
 * "Abgleich mit anderen Computern" (Einstellungen › Daten): several computers keep the same data
 * through a folder they share, such as one in OneDrive or Google Drive. Settings and status are
 * machine-local in main (SyncService).
 */
export function SyncCard() {
  const utils = trpcReact.useUtils()
  const status = trpcReact.sync.status.useQuery(undefined, {
    // follows the runs in the background while the card is open
    refetchInterval: 5000
  })
  const setStatus = (next: SyncStatusDto) => utils.sync.status.setData(undefined, next)
  const onError = (title: string) => (error: { message: string }) =>
    toast.error(title, { description: error.message })

  const chooseFolder = trpcReact.sync.chooseFolder.useMutation({
    onError: onError('Ordner kann nicht verwendet werden')
  })
  const setUp = trpcReact.sync.setUp.useMutation({
    onSuccess: (next) => {
      setStatus(next)
      toast.success('Abgleich eingerichtet', {
        description:
          'Auf dem anderen Computer jetzt unter Einstellungen › Daten denselben Ordner wählen und beitreten.'
      })
    },
    onError: onError('Abgleich konnte nicht eingerichtet werden')
  })
  const join = trpcReact.sync.join.useMutation({
    onSuccess: (result) =>
      toast.success('Daten zusammengeführt', {
        description: `${result.matched} gemeinsame Einträge erkannt, ${result.inserted} Einträge dieses Computers hinzugefügt. Bookingium startet neu.`,
        duration: 10000
      }),
    onError: onError('Beitreten fehlgeschlagen')
  })
  const runNow = trpcReact.sync.runNow.useMutation({
    onSuccess: (next) => {
      setStatus(next)
      if (next.lastError) toast.error('Abgleich fehlgeschlagen', { description: next.lastError })
      else toast.success('Abgeglichen')
    },
    onError: onError('Abgleich fehlgeschlagen')
  })
  const leave = trpcReact.sync.leave.useMutation({
    onSuccess: (next) => {
      setStatus(next)
      toast.success('Abgleich auf diesem Computer beendet')
    },
    onError: onError('Abgleich konnte nicht beendet werden')
  })
  const inspect = trpcReact.sync.inspectFolder.useMutation({
    onError: onError('Ordner kann nicht verwendet werden')
  })
  const openFolder = trpcReact.sync.openFolder.useMutation({
    onError: onError('Ordner konnte nicht geöffnet werden')
  })

  const start = async () => {
    const folder = await chooseFolder.mutateAsync().catch(() => null)
    if (!folder) return
    if (folder.kind === 'new') await confirmSetUp(folder)
    else await confirmJoin(folder)
  }

  const confirmSetUp = async (folder: SyncFolderDto) => {
    const ok = await confirmAction({
      title: 'Abgleich hier einrichten?',
      description: `In „${folder.folder}“ ist noch kein Abgleich. Dieser Computer wird der erste: Seine Daten und Dokumente werden dort als gemeinsamer Startstand abgelegt. Weitere Computer wählen danach denselben Ordner und treten bei.`,
      confirmLabel: 'Einrichten'
    })
    if (ok) setUp.mutate(folder.folder)
  }

  const confirmJoin = async (folder: SyncFolderDto) => {
    const others = folder.devices.length > 0 ? folder.devices.join(', ') : 'ein anderer Computer'
    const ok = await confirmAction({
      title: 'Dem Abgleich beitreten?',
      description: `Dabei: ${others}. Die Daten dieses Computers werden mit denen der anderen zusammengeführt; Einträge, die es auf beiden gibt (gleiche Band, Person, Firma, gleiches Event, gleiche Rechnungsnummer …), werden erkannt und nur einmal übernommen. Der aktuelle Stand wird vorher gesichert. Bookingium startet dazu neu.`,
      confirmLabel: 'Zusammenführen und neu starten'
    })
    if (ok) join.mutate(folder.folder)
  }

  const confirmLeave = async () => {
    const ok = await confirmAction({
      title: 'Abgleich beenden?',
      description:
        'Dieser Computer bekommt dann keine Änderungen der anderen mehr und gibt seine nicht mehr weiter. Die Daten bleiben hier erhalten. Später lässt er sich wieder anschließen: Beim erneuten Beitreten werden die Daten wieder zusammengeführt.',
      confirmLabel: 'Beenden',
      destructive: true
    })
    if (ok) leave.mutate()
  }

  /** The switch: off leaves the sync, on joins the chosen folder again (or picks one) */
  const toggle = async (checked: boolean) => {
    if (!checked) return void confirmLeave()
    const folder = data?.folder
    if (!folder) return void start()
    const inspected = await inspect.mutateAsync(folder).catch(() => null)
    if (!inspected) return
    if (inspected.kind === 'new') await confirmSetUp(inspected)
    else await confirmJoin(inspected)
  }

  const data = status.data
  const enabled = data?.enabled ?? false
  const folder = data?.folder ?? ''
  const busy = chooseFolder.isPending || inspect.isPending || setUp.isPending || join.isPending

  return (
    <Card id="settings-sync">
      <CardHeader>
        <CardTitle>Abgleich mit anderen Computern</CardTitle>
        <CardDescription>
          Mehrere Computer arbeiten mit denselben Daten: Jede Änderung, auch an Dokumenten, kommt
          nach wenigen Sekunden auf den anderen an. Ausgetauscht wird über einen Ordner, auf den
          alle Zugriff haben, zum Beispiel einen geteilten Ordner in OneDrive oder Google Drive.
          E-Mail-Konten und E-Mails gleicht jeder Computer selbst mit dem Mailserver ab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Switch
              id="settings-sync-enabled"
              checked={enabled}
              onCheckedChange={(checked) => void toggle(checked)}
              disabled={busy || leave.isPending}
            />
            <Label htmlFor="settings-sync-enabled">Mit anderen Computern abgleichen</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Auf dem ersten Computer einen leeren Ordner wählen, auf jedem weiteren denselben. Beim
            Beitreten werden die Daten zusammengeführt, ohne dass etwas doppelt vorkommt; der Stand
            davor wird gesichert.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Gemeinsamer Ordner</p>
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={folder || undefined}
            >
              {folder || 'Kein Ordner gewählt'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {folder && (
              <Button variant="ghost" onClick={() => openFolder.mutate()}>
                <FolderOpen className="h-4 w-4" /> Öffnen
              </Button>
            )}
            {!enabled && (
              <Button variant="outline" onClick={() => void start()} disabled={busy}>
                {busy ? 'Bitte warten…' : folder ? 'Anderer Ordner…' : 'Ordner wählen…'}
              </Button>
            )}
          </div>
        </div>

        {data && (enabled || data.lastError) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {enabled ? (
                <SyncState status={data} />
              ) : (
                <p className="text-sm text-destructive">{data.lastError}</p>
              )}
            </div>
            {enabled && (
              <Button
                variant="outline"
                onClick={() => runNow.mutate()}
                disabled={data.running || runNow.isPending || !data.active}
              >
                <RefreshCw className="h-4 w-4" /> Jetzt abgleichen
              </Button>
            )}
          </div>
        )}

        {enabled && data && data.devices.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">Computer im Abgleich</p>
            <ul className="space-y-1 text-sm">
              {data.devices.map((device) => (
                <li key={device.id} className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-muted-foreground" />
                  <span>{device.name}</span>
                  {device.self && <span className="text-muted-foreground">(dieser Computer)</span>}
                  <span className="text-xs text-muted-foreground">Version {device.appVersion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {enabled && data && data.conflicts.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">Nicht übernommene Änderungen</p>
            <ul className="space-y-1 text-sm">
              {data.conflicts.map((conflict) => (
                <li key={conflict.id} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    <span className="text-muted-foreground">{formatDateTime(conflict.at)}: </span>
                    {conflict.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
