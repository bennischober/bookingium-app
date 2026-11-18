import { History } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { localIsoDate } from '@/lib/followUps'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OpenItemsList } from './OpenItemsList'

/**
 * #201: Dashboard "Offene Punkte" - what waits today: contracts not back, deposits due, shows
 * over without an invoice, shows soon without a hotel, and follow-ups due today or earlier.
 * The follow-ups are only counted here: the "Wiedervorlagen" card right below lists them with
 * their actions, and listing them twice would show each one twice.
 * Fetched on every visit (staleTime 0): invoices and events change on other pages.
 */
export function OpenItemsCard() {
  const items = trpcReact.dashboard.openItems.useQuery({}, { staleTime: 0 })
  const followUps = trpcReact.followUp.listOpen.useQuery()
  const today = localIsoDate()
  const dueFollowUps = (followUps.data ?? []).filter((followUp) => followUp.dueDate <= today).length
  const open = items.data ?? []
  const count = open.length + dueFollowUps

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Offene Punkte
          {count > 0 && <span className="ml-2 font-normal text-muted-foreground">{count}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.isLoading || followUps.isLoading ? (
          <p className="text-sm text-muted-foreground">Offene Punkte werden geladen…</p>
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nichts offen: alle Verträge zurück, keine Vorkasse fällig, jede vergangene Show
            abgerechnet, jede Show der nächsten Wochen mit Hotel und keine Wiedervorlage fällig.
          </p>
        ) : (
          <>
            {open.length > 0 && <OpenItemsList items={open} showEvent />}
            {dueFollowUps > 0 && (
              <p className="flex items-center gap-3 text-sm">
                <History className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                {dueFollowUps === 1
                  ? '1 Wiedervorlage ist fällig, siehe „Wiedervorlagen“'
                  : `${dueFollowUps} Wiedervorlagen sind fällig, siehe „Wiedervorlagen“`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
