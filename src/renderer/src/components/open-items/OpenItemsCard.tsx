import { trpcReact } from '@/lib/trpc'
import { localIsoDate } from '@/lib/followUps'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FollowUpList } from '@/components/follow-ups/FollowUpList'
import { OpenItemsList } from './OpenItemsList'

/**
 * #201: Dashboard "Offene Punkte" - what waits today: contracts not back, deposits due, shows
 * over without an invoice, shows soon without a hotel, and follow-ups due today or earlier.
 * Fetched on every visit (staleTime 0): invoices and events change on other pages.
 */
export function OpenItemsCard() {
  const items = trpcReact.dashboard.openItems.useQuery({}, { staleTime: 0 })
  const followUps = trpcReact.followUp.listOpen.useQuery()
  const today = localIsoDate()
  const dueFollowUps = (followUps.data ?? []).filter((followUp) => followUp.dueDate <= today)
  const open = items.data ?? []
  const count = open.length + dueFollowUps.length

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Offene Punkte
          {count > 0 && <span className="ml-2 font-normal text-muted-foreground">{count}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.isLoading || followUps.isLoading ? (
          <p className="text-sm text-muted-foreground">Offene Punkte werden geladen…</p>
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nichts offen: alle Verträge zurück, keine Vorkasse fällig, jede vergangene Show
            abgerechnet und jede Show der nächsten Wochen mit Hotel.
          </p>
        ) : (
          <>
            {open.length > 0 && <OpenItemsList items={open} showEvent />}
            {dueFollowUps.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Fällige Wiedervorlagen</p>
                <FollowUpList followUps={dueFollowUps} showRecord />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
