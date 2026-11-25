import { useState } from 'react'
import { CheckCheck, History } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { localIsoDate } from '@/lib/followUps'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OpenItemDto } from '../../../../main/api/schemas/open_items.schema'
import type { EventStepRef } from '../../../../main/api/schemas/event_step.schema'
import { OpenItemsList } from './OpenItemsList'
import { openItemKey } from './openItemText'
import { t } from '../../../../main/i18n/translate'

/**
 * #201: Dashboard "Offene Punkte" - what waits today: contracts not back, deposits due, shows
 * over without an invoice, shows soon without a hotel, and follow-ups due today or earlier.
 * The follow-ups are only counted here: the "Wiedervorlagen" card right below lists them with
 * their actions, and listing them twice would show each one twice.
 * Fetched on every visit (staleTime 0): invoices and events change on other pages.
 *
 * "Auswählen" ticks several points as done outside the program ("extern erledigt") at once,
 * e.g. old shows the accounting has long settled. Each becomes the event's ticked step, so
 * it can be unticked on the event page any time (or right away from the toast).
 */
export function OpenItemsCard() {
  const items = trpcReact.dashboard.openItems.useQuery({}, { staleTime: 0 })
  const followUps = trpcReact.followUp.listOpen.useQuery()
  const today = localIsoDate()
  const dueFollowUps = (followUps.data ?? []).filter((followUp) => followUp.dueDate <= today).length
  const open = items.data ?? []
  const count = open.length + dueFollowUps

  const utils = trpcReact.useUtils()
  const setMany = trpcReact.eventStep.setMany.useMutation({
    onSettled: () => {
      void utils.dashboard.openItems.invalidate()
      void utils.eventStep.list.invalidate()
    }
  })
  // null: not selecting; a set of row keys while selecting
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const chosen = selected ? open.filter((item) => selected.has(openItemKey(item))) : []
  const allChosen = open.length > 0 && chosen.length === open.length

  const toggle = (item: OpenItemDto) =>
    setSelected((current) => {
      const next = new Set(current)
      const key = openItemKey(item)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const markDone = async () => {
    const pointCount =
      chosen.length === 1 ? t('1 Punkt') : t('{{count}} Punkte', { count: chosen.length })
    if (
      !(await confirmAction({
        title: t('{{pointCount}} als extern erledigt markieren?', { pointCount }),
        description: t(
          'Die Punkte verschwinden aus den offenen Punkten. Auf der Seite des Events lässt sich jeder Haken wieder entfernen, z. B. wenn doch noch eine Abrechnung kommt.'
        ),
        confirmLabel: t('Als erledigt markieren')
      }))
    ) {
      return
    }
    const steps: EventStepRef[] = chosen.map((item) => ({ eventId: item.eventId, step: item.kind }))
    try {
      const { changed } = await setMany.mutateAsync({ steps, done: true })
      setSelected(null)
      toast.success(t('{{pointCount}} als extern erledigt markiert', { pointCount }), {
        action:
          changed.length === 0
            ? undefined
            : {
                label: t('Rückgängig'),
                onClick: () =>
                  setMany.mutate(
                    { steps: changed, done: false },
                    {
                      onError: (error) =>
                        toast.error(t('Rückgängig fehlgeschlagen'), {
                          description: error.message
                        })
                    }
                  )
              }
      })
    } catch (error) {
      toast.error(t('Konnte nicht gespeichert werden'), {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>
          {t('Offene Punkte')}
          {count > 0 && <span className="ml-2 font-normal text-muted-foreground">{count}</span>}
        </CardTitle>
        {open.length > 0 && !selected && (
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            <CheckCheck className="h-4 w-4" aria-hidden />
            {t('Auswählen')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {items.isLoading || followUps.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('Offene Punkte werden geladen…')}</p>
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'Nichts offen: alle Verträge zurück, keine Vorkasse fällig, jede vergangene Show abgerechnet, jede Show der nächsten Wochen mit Hotel und keine Wiedervorlage fällig.'
            )}
          </p>
        ) : (
          <>
            {selected && open.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={allChosen}
                    ref={(box) => {
                      if (box) box.indeterminate = chosen.length > 0 && !allChosen
                    }}
                    onChange={() =>
                      setSelected(allChosen ? new Set() : new Set(open.map(openItemKey)))
                    }
                  />
                  {t('Alle auswählen')}
                </label>
                <span className="text-muted-foreground">
                  {t('{{selectedCount}} von {{total}} ausgewählt', {
                    selectedCount: chosen.length,
                    total: open.length
                  })}
                </span>
                <span className="ml-auto flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    {t('Abbrechen')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={chosen.length === 0 || setMany.isPending}
                    onClick={() => void markDone()}
                  >
                    {t('Als extern erledigt markieren')}
                  </Button>
                </span>
              </div>
            )}
            {open.length > 0 && (
              <OpenItemsList
                items={open}
                showEvent
                selected={selected ?? undefined}
                onToggle={toggle}
              />
            )}
            {dueFollowUps > 0 && (
              <p className="flex items-center gap-3 text-sm">
                <History className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                {dueFollowUps === 1
                  ? t('1 Wiedervorlage ist fällig, siehe „Wiedervorlagen“')
                  : t('{{dueFollowUps}} Wiedervorlagen sind fällig, siehe „Wiedervorlagen“', {
                      dueFollowUps
                    })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
