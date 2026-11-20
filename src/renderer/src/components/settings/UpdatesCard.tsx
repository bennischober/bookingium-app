import { Download, RefreshCw } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { UpdateStatusDto } from '../../../../main/api/schemas/updates.schema'
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

function phaseText(status: UpdateStatusDto): string {
  switch (status.phase) {
    case 'unsupported':
      return t('Updates gibt es nur für die installierte App.')
    case 'idle':
      return t('Bookingium sucht kurz nach dem Start nach Updates.')
    case 'checking':
      return t('Sucht nach Updates…')
    case 'current':
      return t('Bookingium ist auf dem neuesten Stand.')
    case 'downloading':
      return t('Version {{version}} wird heruntergeladen{{value}}…', {
        version: status.version,
        value: status.percent !== null ? ` (${status.percent} %)` : ''
      })
    case 'ready':
      return t(
        'Version {{version}} ist bereit und wird beim Schließen von Bookingium installiert.',
        { version: status.version }
      )
    case 'error':
      return status.error ?? t('Die Suche nach Updates ist fehlgeschlagen.')
  }
}

/**
 * "Version und Updates" (Einstellungen › Daten, #49): the installed app looks for new versions on
 * GitHub, downloads them in the background and installs them when it closes (src/main/app/updates.ts).
 */
export function UpdatesCard() {
  const utils = trpcReact.useUtils()
  const status = trpcReact.updates.status.useQuery(undefined, {
    // follows a download in the background
    refetchInterval: (data) =>
      data?.phase === 'downloading' || data?.phase === 'checking' ? 1000 : 10000
  })
  const check = trpcReact.updates.check.useMutation({
    onSuccess: (next) => {
      utils.updates.status.setData(undefined, next)
      if (next.phase === 'current') toast.success(t('Bookingium ist auf dem neuesten Stand'))
      else if (next.phase === 'error')
        toast.error(t('Suche fehlgeschlagen'), { description: next.error ?? undefined })
    },
    onError: (error) => toast.error(t('Suche fehlgeschlagen'), { description: error.message })
  })
  const install = trpcReact.updates.install.useMutation({
    onError: (error) =>
      toast.error(t('Update kann nicht installiert werden'), { description: error.message })
  })

  const data = status.data
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Version und Updates')}</CardTitle>
        <CardDescription>
          {t(
            'Neue Versionen lädt Bookingium selbst herunter und installiert sie beim Schließen. Die Daten bleiben dabei erhalten. Mit dem Abgleich sollten alle Computer dieselbe Version haben.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          <p>
            {t('Installierte Version:')}{' '}
            <span className="font-medium">{data?.currentVersion ?? '…'}</span>
          </p>
          {data && (
            <p className={data.phase === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
              {phaseText(data)}
            </p>
          )}
          {data?.lastCheckAt && (
            <p className="text-xs text-muted-foreground">
              {t('Zuletzt gesucht:')} {formatDateTime(data.lastCheckAt)}
            </p>
          )}
        </div>
        {data && data.phase !== 'unsupported' && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => check.mutate()}
              disabled={
                check.isPending || data.phase === 'checking' || data.phase === 'downloading'
              }
            >
              <RefreshCw className="h-4 w-4" /> {t('Nach Updates suchen')}
            </Button>
            {data.phase === 'ready' && (
              <Button onClick={() => install.mutate()} disabled={install.isPending}>
                <Download className="h-4 w-4" /> {t('Jetzt neu starten und installieren')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
