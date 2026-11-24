import { useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CalendarFeedStatusDto } from '../../../../main/api/schemas/settings.schema'
import type { ShareLinkCheckDto } from '../../../../main/api/schemas/calendar_subscription.schema'
import { t, uiLocale } from '../../../../main/i18n/translate'

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('Adresse kopiert'))
  } catch (error) {
    toast.error(t('Kopieren fehlgeschlagen'), {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * #53: the public address of the calendar file. Calendar apps fetch subscriptions from their
 * own servers, so they need a web address; a OneDrive or Dropbox share link of the file gives
 * one. Bookingium turns it into the direct download address and checks that the file is there.
 */
export function CalendarShareLink({ feed }: { feed: CalendarFeedStatusDto }) {
  const utils = trpcReact.useUtils()
  const [link, setLink] = useState(feed.shareUrl)
  const [check, setCheck] = useState<ShareLinkCheckDto | null>(null)
  const runCheck = trpcReact.calendar.checkShareLink.useMutation({
    onSuccess: (result) => {
      setCheck(result)
      void utils.calendar.status.invalidate()
    },
    onError: (error) =>
      toast.error(t('Link konnte nicht geprüft werden'), { description: error.message })
  })
  const clear = trpcReact.calendar.clearShareLink.useMutation({
    onSuccess: (next) => {
      utils.calendar.status.setData(undefined, next)
      setLink('')
      setCheck(null)
    }
  })
  const subscribeUrl = check?.subscribeUrl || feed.subscribeUrl

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="calendar-share-link">
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('In Outlook, Google oder Apple abonnieren')}</p>
        <p className="text-xs text-muted-foreground">
          {t(
            'Kalender-Apps holen ein Abo über eine Web-Adresse. Die Datei dafür in einem OneDrive- oder Dropbox-Ordner speichern, dort „Teilen“ → „Jeder mit dem Link“ wählen und den Link hier einfügen. Bookingium macht daraus die Abo-Adresse und prüft, ob die Datei darüber erreichbar ist.'
          )}
        </p>
        {!feed.inCloudFolder && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t(
              'Die Datei liegt in keinem OneDrive-, Google-Drive- oder Dropbox-Ordner dieses Computers. Mit „Andere Datei…“ dorthin verlegen, sonst gibt es keinen Link zum Teilen.'
            )}
          </p>
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (link.trim()) runCheck.mutate(link.trim())
        }}
      >
        <div className="min-w-64 flex-1 space-y-1">
          <Label htmlFor="calendar-share-link">{t('Freigabe-Link der Datei')}</Label>
          <Input
            id="calendar-share-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://1drv.ms/… · https://www.dropbox.com/…"
          />
        </div>
        <Button type="submit" variant="outline" disabled={!link.trim() || runCheck.isPending}>
          <Link2 className="h-4 w-4" />
          {runCheck.isPending ? t('Wird geprüft…') : t('Prüfen')}
        </Button>
        {feed.shareUrl && (
          <Button type="button" variant="ghost" onClick={() => clear.mutate()}>
            {t('Entfernen')}
          </Button>
        )}
      </form>

      {check && !check.ok && (
        <p className="text-sm text-destructive" role="alert">
          {check.error}
        </p>
      )}
      {check?.ok && (
        <p className="flex items-start gap-1.5 text-sm text-green-700 dark:text-green-400">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('Erreichbar: Bookingium-Kalender mit {{events}} Einträgen, Stand {{written}}.', {
              events: check.events,
              written: check.writtenAt
                ? new Date(check.writtenAt).toLocaleString(uiLocale())
                : t('unbekannt')
            })}
            {check.stale &&
              ` ${t('Die Cloud hat noch einen älteren Stand – nach dem Hochladen erneut prüfen.')}`}
          </span>
        </p>
      )}

      {subscribeUrl && (
        <div className="space-y-2">
          <Label htmlFor="calendar-subscribe-url">{t('Abo-Adresse')}</Label>
          <div className="flex gap-2">
            <Input
              id="calendar-subscribe-url"
              readOnly
              value={subscribeUrl}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={() => void copy(subscribeUrl)}>
              <Copy className="h-4 w-4" /> {t('Kopieren')}
            </Button>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            <li>
              {t(
                'Google Kalender (im Browser): „Weitere Kalender“ → „+“ → „Per URL“ → Adresse einfügen. Google lädt Abos nur alle paar Stunden neu.'
              )}
            </li>
            <li>
              {t(
                'Outlook: „Kalender hinzufügen“ → „Aus dem Internet abonnieren“ → Adresse einfügen.'
              )}
            </li>
            <li>
              {t(
                'Apple Kalender (Mac, iPhone): „Ablage“ → „Neues Kalenderabonnement“ bzw. Einstellungen → Kalender → Accounts → „Abonnierten Kalender hinzufügen“.'
              )}
            </li>
          </ul>
          {feed.includeFollowUps || feed.includeAppointments ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t(
                'Wer die Adresse kennt, sieht auch die Wiedervorlagen bzw. eigenen Termine, die in der Datei stehen.'
              )}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
