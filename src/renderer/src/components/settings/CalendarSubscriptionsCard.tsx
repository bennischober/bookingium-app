import { useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { parseTimestamp } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  SUBSCRIPTION_COLORS,
  type CalendarSubscriptionDto
} from '../../../../main/api/schemas/calendar_subscription.schema'
import { t, uiLocale } from '../../../../main/i18n/translate'

function SubscriptionRow({ subscription }: { subscription: CalendarSubscriptionDto }) {
  const utils = trpcReact.useUtils()
  const [name, setName] = useState(subscription.name)
  const invalidate = () => {
    void utils.calendar.listSubscriptions.invalidate()
    void utils.calendar.subscribedBetween.invalidate()
  }
  const update = trpcReact.calendar.updateSubscription.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toast.error(t('Einstellung konnte nicht gespeichert werden'), { description: error.message })
  })
  const remove = trpcReact.calendar.removeSubscription.useMutation({
    onSuccess: () => {
      invalidate()
      toast.success(t('Abo entfernt'))
    }
  })
  const refresh = trpcReact.calendar.refreshSubscriptions.useMutation({
    onSuccess: (list) => {
      utils.calendar.listSubscriptions.setData(undefined, list)
      void utils.calendar.subscribedBetween.invalidate()
      const error = list.find((s) => s.id === subscription.id)?.error
      if (error) toast.error(t('Kalender konnte nicht geladen werden'), { description: error })
      else toast.success(t('Kalender aktualisiert'))
    }
  })
  const fetchedAt = subscription.fetchedAt ? parseTimestamp(subscription.fetchedAt) : null

  return (
    <li className="space-y-2 rounded-md border p-3" data-testid="calendar-subscription">
      <div className="flex flex-wrap items-center gap-2">
        <Switch
          checked={subscription.enabled}
          onCheckedChange={(enabled) => update.mutate({ id: subscription.id, enabled })}
          aria-label={t('Im Kalender zeigen')}
        />
        <Input
          aria-label={t('Name des Abos')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim()
            if (trimmed && trimmed !== subscription.name)
              update.mutate({ id: subscription.id, name: trimmed })
            else setName(subscription.name)
          }}
          className="h-8 w-56"
        />
        <div className="flex gap-1" role="radiogroup" aria-label={t('Farbe')}>
          {SUBSCRIPTION_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={subscription.color === color}
              aria-label={color}
              onClick={() => update.mutate({ id: subscription.id, color })}
              className="size-5 rounded-full border-2 aria-checked:border-foreground border-transparent"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refresh.mutate(subscription.id)}
            disabled={refresh.isPending}
            aria-label={t('Jetzt aktualisieren')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => remove.mutate(subscription.id)}
            aria-label={t('Abo entfernen')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground" title={subscription.url}>
        {subscription.url}
      </p>
      <p className="text-xs text-muted-foreground">
        {fetchedAt
          ? t('Zuletzt geladen {{time}} · {{count}} Einträge', {
              time: fetchedAt.toLocaleString(uiLocale()),
              count: subscription.eventCount
            })
          : t('Noch nicht geladen.')}
      </p>
      {subscription.error && <p className="text-xs text-destructive">{subscription.error}</p>}
    </li>
  )
}

/**
 * #53: other calendars (Google, iCloud, Outlook, ...) subscribed by their ICS address, shown
 * read-only in Bookingium's calendar. The list is shared with the other computers; each fetches
 * the calendars itself.
 */
export function CalendarSubscriptionsCard() {
  const utils = trpcReact.useUtils()
  const list = trpcReact.calendar.listSubscriptions.useQuery(undefined, {
    refetchInterval: 2 * 60_000
  })
  const [url, setUrl] = useState('')
  const add = trpcReact.calendar.addSubscription.useMutation({
    onSuccess: (created) => {
      setUrl('')
      void utils.calendar.listSubscriptions.invalidate()
      void utils.calendar.subscribedBetween.invalidate()
      toast.success(t('„{{name}}“ abonniert', { name: created.name }))
    },
    onError: (error) =>
      toast.error(t('Kalender konnte nicht abonniert werden'), { description: error.message })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Abonnierte Kalender')}</CardTitle>
        <CardDescription>
          {t(
            'Andere Kalender im Bookingium-Kalender zeigen, nur zum Ansehen. Bookingium lädt sie beim Start und jede halbe Stunde neu.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (url.trim()) add.mutate({ url: url.trim() })
          }}
        >
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="calendar-subscription-url">{t('Adresse des Kalenders (ICS)')}</Label>
            <Input
              id="calendar-subscription-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… .ics · webcal://…"
            />
          </div>
          <Button type="submit" disabled={!url.trim() || add.isPending}>
            <Plus className="h-4 w-4" />
            {add.isPending ? t('Wird geladen…') : t('Abonnieren')}
          </Button>
        </form>

        {(list.data ?? []).length > 0 ? (
          <ul className="space-y-2">
            {list.data?.map((subscription) => (
              <SubscriptionRow key={subscription.id} subscription={subscription} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Noch keine Kalender abonniert.')}</p>
        )}

        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          <li>
            {t(
              'Google Kalender: Einstellungen des Kalenders → „Kalender integrieren“ → „Privatadresse im iCal-Format“.'
            )}
          </li>
          <li>
            {t(
              'iCloud: in der Kalender-App beim Kalender „Teilen“ → „Öffentlicher Kalender“ → Link kopieren (webcal://…).'
            )}
          </li>
          <li>
            {t(
              'Outlook: Einstellungen → Kalender → „Freigegebene Kalender“ → „Kalender veröffentlichen“ → ICS-Link.'
            )}
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}
