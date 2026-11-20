import { useState } from 'react'
import { FolderOpen, History, Lock, RefreshCw } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RestorePasswordDialog, SetBackupPasswordDialog } from './BackupPasswordDialogs'
import type {
  BackupStatusDto,
  PreparedRestoreDto
} from '../../../../main/api/schemas/backup.schema'
import { t, uiLocale } from '../../../../main/i18n/translate'

/** "28.10.2026, 14:30" */
const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(uiLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

function LastBackup({ status }: { status: BackupStatusDto }) {
  if (status.running) return <p className="text-sm text-muted-foreground">{t('Wird gesichert…')}</p>
  if (status.lastError && status.lastAttemptAt)
    return (
      <div className="text-sm">
        <p className="text-destructive">
          {t('Letzte Sicherung fehlgeschlagen (')}
          {formatDateTime(status.lastAttemptAt)}): {status.lastError}
        </p>
        {status.lastSuccessAt && (
          <p className="text-muted-foreground">
            {t('Letzte erfolgreiche Sicherung:')} {formatDateTime(status.lastSuccessAt)}
          </p>
        )}
      </div>
    )
  if (status.lastSuccessAt)
    return (
      <p className="text-sm text-muted-foreground">
        {t('Letzte Sicherung:')} {formatDateTime(status.lastSuccessAt)} {t('– erfolgreich')}
      </p>
    )
  return <p className="text-sm text-muted-foreground">{t('Noch keine Sicherung.')}</p>
}

function LastRestore({ status }: { status: BackupStatusDto }) {
  const restore = status.lastRestore
  if (!restore) return null
  if (restore.error)
    return (
      <p className="text-sm text-destructive">
        {t('Wiederherstellen am')} {formatDateTime(restore.at)} fehlgeschlagen: {restore.error}{' '}
        {t('Die bisherigen Daten sind unverändert.')}
      </p>
    )
  return (
    <p className="text-sm text-muted-foreground">
      {t('Am')} {formatDateTime(restore.at)} wiederhergestellt
      {restore.backupCreatedAt ? ` (Sicherung vom ${formatDateTime(restore.backupCreatedAt)})` : ''}
      {t('. Der Stand davor liegt in „')}
      {status.beforeRestoreFolder ?? restore.source}“.
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
    onError: onError(t('Ordner kann nicht verwendet werden'))
  })
  const setEnabled = trpcReact.backup.setEnabled.useMutation({
    onSuccess: setStatus,
    onError: onError(t('Einstellung konnte nicht gespeichert werden'))
  })
  const runNow = trpcReact.backup.runNow.useMutation({
    onSuccess: (next) => {
      setStatus(next)
      if (next.lastError)
        toast.error(t('Sicherung fehlgeschlagen'), { description: next.lastError })
      else toast.success(t('Sicherung erstellt'), { description: next.lastFolder ?? undefined })
    },
    onError: onError(t('Sicherung fehlgeschlagen'))
  })
  const openFolder = trpcReact.backup.openFolder.useMutation({
    onError: onError(t('Ordner konnte nicht geöffnet werden'))
  })
  const cancelRestore = trpcReact.backup.cancelRestore.useMutation()
  const confirmRestore = trpcReact.backup.confirmRestore.useMutation({
    onSuccess: () =>
      toast.success(t('Wiederherstellen vorbereitet'), {
        description: t('Bookingium startet neu und übernimmt die Sicherung.')
      }),
    onError: onError(t('Wiederherstellen fehlgeschlagen'))
  })
  const pickRestore = trpcReact.backup.pickRestore.useMutation({
    onError: onError(t('Sicherung kann nicht wiederhergestellt werden'))
  })
  const removePassword = trpcReact.backup.removePassword.useMutation({
    onSuccess: (next) => {
      setStatus(next)
      toast.success(t('Sicherungen werden nicht mehr verschlüsselt'))
    },
    onError: onError(t('Einstellung konnte nicht gespeichert werden'))
  })
  // #54: the password dialog, and the restore waiting for a backup's password
  const [passwordDialog, setPasswordDialog] = useState(false)
  const [unlocking, setUnlocking] = useState<string | null>(null)

  const takenText = (prepared: PreparedRestoreDto) =>
    prepared.backupCreatedAt
      ? `vom ${formatDateTime(prepared.backupCreatedAt)}`
      : t('aus „{{folder}}“', { folder: prepared.folder })

  const restore = async () => {
    const prepared = await pickRestore.mutateAsync().catch(() => null)
    if (!prepared || prepared.canceled) return
    if (prepared.needsPassword) setUnlocking(takenText(prepared))
    else await confirmPrepared(prepared)
  }

  const confirmPrepared = async (prepared: PreparedRestoreDto) => {
    const taken = takenText(prepared)
    const ok = await confirmAction({
      title: t('Sicherung wiederherstellen?'),
      description: t(
        prepared.hasStorage
          ? 'Die Sicherung {{taken}} ersetzt alle aktuellen Daten und Dokumente. Der aktuelle Stand wird vorher gesichert. Bookingium startet dazu neu.'
          : 'Die Sicherung {{taken}} ersetzt alle aktuellen Daten. Der aktuelle Stand wird vorher gesichert. Bookingium startet dazu neu.',
        { taken }
      ),
      confirmLabel: t('Wiederherstellen und neu starten'),
      destructive: true
    })
    if (ok) confirmRestore.mutate()
    else cancelRestore.mutate()
  }

  const encryptionSwitch = async (checked: boolean) => {
    if (checked) {
      setPasswordDialog(true)
      return
    }
    const ok = await confirmAction({
      title: t('Verschlüsselung ausschalten?'),
      description: t(
        'Neue Sicherungen werden dann unverschlüsselt in den Sicherungsordner geschrieben. Bereits verschlüsselte Sicherungen bleiben verschlüsselt und brauchen weiter ihr Passwort.'
      ),
      confirmLabel: t('Ausschalten'),
      destructive: true
    })
    if (ok) removePassword.mutate()
  }

  const data = status.data
  const folder = data?.folder ?? ''
  const busy = data?.running || runNow.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Automatische Sicherung')}</CardTitle>
        <CardDescription>
          {t(
            'Sichert Datenbank und Dokumente einmal am Tag in einen Ordner Ihrer Wahl, zum Beispiel einen, den OneDrive oder Dropbox abgleicht.'
          )}
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
            <Label htmlFor="settings-backup-enabled">{t('Automatisch sichern')}</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('Behalten werden die Sicherungen der letzten')} {data?.retention.daily ?? 7}{' '}
            {t('Tage und je eine der letzten')} {data?.retention.weekly ?? 4}{' '}
            {t(
              'Wochen; ältere automatische Sicherungen werden gelöscht. Andere Dateien und Ordner im Sicherungsordner bleiben unberührt.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{t('Sicherungsordner')}</p>
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={folder || undefined}
            >
              {folder || t('Kein Ordner gewählt')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {folder && (
              <Button variant="ghost" onClick={() => openFolder.mutate()}>
                <FolderOpen className="h-4 w-4" /> {t('Öffnen')}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => chooseFolder.mutate()}
              disabled={chooseFolder.isPending}
            >
              {folder ? t('Anderer Ordner…') : t('Ordner wählen…')}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Switch
                id="settings-backup-encrypted"
                checked={data?.encrypted ?? false}
                onCheckedChange={(checked) => void encryptionSwitch(checked)}
                disabled={
                  !data ||
                  (!data.encrypted && !data.encryptionAvailable) ||
                  removePassword.isPending
                }
              />
              <Label htmlFor="settings-backup-encrypted" className="flex items-center gap-1.5">
                <Lock className="h-4 w-4" />
                {t('Mit Passwort verschlüsseln')}
              </Label>
            </div>
            {data?.encrypted && (
              <Button variant="ghost" onClick={() => setPasswordDialog(true)}>
                {t('Passwort ändern…')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {data?.encrypted
              ? t(
                  'Sicherungen werden{{value}} mit Passwort verschlüsselt (AES-256). Ohne das Passwort lassen sie sich nicht wiederherstellen.',
                  {
                    value: data.encryptedSince
                      ? t(' seit {{date}}', { date: formatDateTime(data.encryptedSince) })
                      : ''
                  }
                )
              : data && !data.encryptionAvailable
                ? t(
                    'Auf diesem Rechner nicht verfügbar: Windows kann den Schlüssel hier nicht geschützt aufbewahren.'
                  )
                : t(
                    'Schützt die Sicherungen, etwa in einem Cloud-Ordner, vor fremdem Zugriff. Ein vergessenes Passwort kann niemand zurücksetzen.'
                  )}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {data && <LastBackup status={data} />}
            {data && <LastRestore status={data} />}
          </div>
          <Button variant="outline" onClick={() => runNow.mutate()} disabled={!folder || busy}>
            <RefreshCw className="h-4 w-4" />
            {busy ? t('Wird gesichert…') : t('Jetzt sichern')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{t('Wiederherstellen')}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                'Übernimmt eine Sicherung beim nächsten Start. E-Mail-Konten, Passwörter und heruntergeladene E-Mails gehören nicht dazu.'
              )}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void restore()}
            disabled={pickRestore.isPending || confirmRestore.isPending}
          >
            <History className="h-4 w-4" />
            {pickRestore.isPending ? t('Wird geprüft…') : t('Sicherung wiederherstellen…')}
          </Button>
        </div>
        {passwordDialog && (
          <SetBackupPasswordDialog
            change={data?.encrypted ?? false}
            onClose={() => setPasswordDialog(false)}
            onSaved={(next) => {
              setStatus(next)
              setPasswordDialog(false)
              toast.success(t('Sicherungen werden verschlüsselt'))
            }}
          />
        )}
        {unlocking !== null && (
          <RestorePasswordDialog
            taken={unlocking}
            onCancel={() => {
              setUnlocking(null)
              cancelRestore.mutate()
            }}
            onUnlocked={(prepared) => {
              setUnlocking(null)
              void confirmPrepared(prepared)
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}
