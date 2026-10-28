import { FolderOpen, History, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { BackupStatusDto } from '../../../../main/api/schemas/backup.schema'

/** "28.10.2026, 14:30" */
const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

function LastBackup({ status }: { status: BackupStatusDto }) {
  if (status.running) return <p className="text-sm text-muted-foreground">Wird gesichert…</p>
  if (status.lastError && status.lastAttemptAt)
    return (
      <div className="text-sm">
        <p className="text-destructive">
          Letzte Sicherung fehlgeschlagen ({formatDateTime(status.lastAttemptAt)}):{' '}
          {status.lastError}
        </p>
        {status.lastSuccessAt && (
          <p className="text-muted-foreground">
            Letzte erfolgreiche Sicherung: {formatDateTime(status.lastSuccessAt)}
          </p>
        )}
      </div>
    )
  if (status.lastSuccessAt)
    return (
      <p className="text-sm text-muted-foreground">
        Letzte Sicherung: {formatDateTime(status.lastSuccessAt)} – erfolgreich
      </p>
    )
  return <p className="text-sm text-muted-foreground">Noch keine Sicherung.</p>
}

function LastRestore({ status }: { status: BackupStatusDto }) {
  const restore = status.lastRestore
  if (!restore) return null
  if (restore.error)
    return (
      <p className="text-sm text-destructive">
        Wiederherstellen am {formatDateTime(restore.at)} fehlgeschlagen: {restore.error} Die
        bisherigen Daten sind unverändert.
      </p>
    )
  return (
    <p className="text-sm text-muted-foreground">
      Am {formatDateTime(restore.at)} wiederhergestellt
      {restore.backupCreatedAt ? ` (Sicherung vom ${formatDateTime(restore.backupCreatedAt)})` : ''}
      . Der Stand davor liegt in „{status.beforeRestoreFolder ?? restore.source}“.
    </p>
  )
}

/**
 * "Automatische Sicherung" (Einstellungen › Daten): a daily backup into a folder the user
 * chooses, typically one OneDrive or Dropbox syncs, and restoring a backup. Settings and status
 * are machine-local in main (BackupService), so restoring never changes them.
 */
export function BackupCard() {
  const utils = trpcReact.useUtils()
  const status = trpcReact.backup.status.useQuery(undefined, {
    // follows a backup that runs in the background
    refetchInterval: (data) => (data?.running ? 1000 : false)
  })
  const setStatus = (next: BackupStatusDto) => utils.backup.status.setData(undefined, next)
  const onError = (title: string) => (error: { message: string }) =>
    toast.error(title, { description: error.message })

  const chooseFolder = trpcReact.backup.chooseFolder.useMutation({
    onSuccess: setStatus,
    onError: onError('Ordner kann nicht verwendet werden')
  })
  const setEnabled = trpcReact.backup.setEnabled.useMutation({
    onSuccess: setStatus,
    onError: onError('Einstellung konnte nicht gespeichert werden')
  })
  const runNow = trpcReact.backup.runNow.useMutation({
    onSuccess: (next) => {
      setStatus(next)
      if (next.lastError) toast.error('Sicherung fehlgeschlagen', { description: next.lastError })
      else toast.success('Sicherung erstellt', { description: next.lastFolder ?? undefined })
    },
    onError: onError('Sicherung fehlgeschlagen')
  })
  const openFolder = trpcReact.backup.openFolder.useMutation({
    onError: onError('Ordner konnte nicht geöffnet werden')
  })
  const cancelRestore = trpcReact.backup.cancelRestore.useMutation()
  const confirmRestore = trpcReact.backup.confirmRestore.useMutation({
    onSuccess: () =>
      toast.success('Wiederherstellen vorbereitet', {
        description: 'Bookingium startet neu und übernimmt die Sicherung.'
      }),
    onError: onError('Wiederherstellen fehlgeschlagen')
  })
  const pickRestore = trpcReact.backup.pickRestore.useMutation({
    onError: onError('Sicherung kann nicht wiederhergestellt werden')
  })

  const restore = async () => {
    const prepared = await pickRestore.mutateAsync().catch(() => null)
    if (!prepared || prepared.canceled) return
    const taken = prepared.backupCreatedAt
      ? `vom ${formatDateTime(prepared.backupCreatedAt)}`
      : `aus „${prepared.folder}“`
    const ok = await confirmAction({
      title: 'Sicherung wiederherstellen?',
      description:
        `Die Sicherung ${taken} ersetzt alle aktuellen Daten` +
        (prepared.hasStorage ? ' und Dokumente' : '') +
        '. Der aktuelle Stand wird vorher gesichert. Bookingium startet dazu neu.',
      confirmLabel: 'Wiederherstellen und neu starten',
      destructive: true
    })
    if (ok) confirmRestore.mutate()
    else cancelRestore.mutate()
  }

  const data = status.data
  const folder = data?.folder ?? ''
  const busy = data?.running || runNow.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatische Sicherung</CardTitle>
        <CardDescription>
          Sichert Datenbank und Dokumente einmal am Tag in einen Ordner Ihrer Wahl, zum Beispiel
          einen, den OneDrive oder Dropbox abgleicht.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Switch
              id="settings-backup-enabled"
              checked={data?.enabled ?? false}
              onCheckedChange={(checked) => setEnabled.mutate(checked)}
              disabled={!folder || setEnabled.isPending}
            />
            <Label htmlFor="settings-backup-enabled">Automatisch sichern</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Behalten werden die Sicherungen der letzten {data?.retention.daily ?? 7} Tage und je
            eine der letzten {data?.retention.weekly ?? 4} Wochen; ältere automatische Sicherungen
            werden gelöscht. Andere Dateien und Ordner im Sicherungsordner bleiben unberührt.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Sicherungsordner</p>
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
            <Button
              variant="outline"
              onClick={() => chooseFolder.mutate()}
              disabled={chooseFolder.isPending}
            >
              {folder ? 'Anderer Ordner…' : 'Ordner wählen…'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {data && <LastBackup status={data} />}
            {data && <LastRestore status={data} />}
          </div>
          <Button variant="outline" onClick={() => runNow.mutate()} disabled={!folder || busy}>
            <RefreshCw className="h-4 w-4" />
            {busy ? 'Wird gesichert…' : 'Jetzt sichern'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Wiederherstellen</p>
            <p className="text-sm text-muted-foreground">
              Übernimmt eine Sicherung beim nächsten Start. E-Mail-Konten, Passwörter und
              heruntergeladene E-Mails gehören nicht dazu.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void restore()}
            disabled={pickRestore.isPending || confirmRestore.isPending}
          >
            <History className="h-4 w-4" />
            {pickRestore.isPending ? 'Wird geprüft…' : 'Sicherung wiederherstellen…'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
