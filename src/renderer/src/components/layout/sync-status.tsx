import { useNavigate } from '@tanstack/react-router'
import { CloudAlert, CloudCheck, CloudUpload, RefreshCw } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { t, uiLocale } from '../../../../main/i18n/translate'

/** "vor 12 s", "vor 3 min", "um 14:30" */
function sinceText(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `vor ${seconds} s`
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} min`
  return `um ${new Date(iso).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Top bar: the sync with the other computers at a glance - synced, sending, failed - and, on a
 * computer not syncing yet, a sync group found in its OneDrive to join. Opens Einstellungen ›
 * Daten.
 */
export function SyncStatus() {
  const navigate = useNavigate()
  const brief = trpcReact.sync.brief.useQuery(undefined, { refetchInterval: 5000 })
  const data = brief.data
  if (!data) return null
  const open = (): void => void navigate({ to: '/settings', search: { tab: 'data' } })

  if (!data.enabled) {
    if (!data.suggestedFolder) return null
    return (
      <Button
        size="sm"
        variant="outline"
        className="border-amber-400 text-amber-800 dark:text-amber-300"
        title={t('Abgleich gefunden: {{suggestedFolder}}', {
          suggestedFolder: data.suggestedFolder
        })}
        onClick={open}
      >
        <CloudAlert className="h-4 w-4" />
        <span className="hidden md:inline">{t('Abgleich gefunden')}</span>
      </Button>
    )
  }

  const failed = Boolean(data.lastError)
  const Icon = data.running
    ? RefreshCw
    : failed
      ? CloudAlert
      : data.pendingChanges > 0
        ? CloudUpload
        : CloudCheck
  const label = failed
    ? t('Abgleich fehlgeschlagen: {{lastError}}', { lastError: data.lastError })
    : data.running
      ? t('Wird abgeglichen…')
      : data.pendingChanges > 0
        ? t('{{pendingChanges}} Änderungen gehen gleich an die anderen Computer', {
            pendingChanges: data.pendingChanges
          })
        : data.lastSuccessAt
          ? t('Abgeglichen {{sinceText}}', { sinceText: sinceText(data.lastSuccessAt) })
          : t('Noch nicht abgeglichen')
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={open}
      className={cn(failed && 'text-destructive')}
    >
      <Icon className={cn('h-4 w-4', data.running && 'animate-spin')} />
    </Button>
  )
}
