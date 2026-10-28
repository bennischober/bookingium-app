import { useState } from 'react'
import { Plus } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { addDays, localIsoDate } from '@/lib/followUps'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FollowUpDialog } from './FollowUpDialog'
import { FollowUpList } from './FollowUpList'

// Further out than this, follow-ups wait behind "weitere anzeigen"
const HORIZON_DAYS = 14

/** Dashboard card: overdue, today's and the next two weeks' follow-ups */
export function FollowUpsCard() {
  const [creating, setCreating] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const query = trpcReact.followUp.listOpen.useQuery()
  const followUps = query.data ?? []

  const horizon = addDays(localIsoDate(), HORIZON_DAYS)
  const soon = followUps.filter((followUp) => followUp.dueDate <= horizon)
  const later = followUps.length - soon.length
  const shown = showAll ? followUps : soon

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Wiedervorlagen</CardTitle>
        <Button variant="outline" className="gap-1.5" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Wiedervorlage
        </Button>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Wiedervorlagen werden geladen…</p>
        ) : followUps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine offenen Wiedervorlagen. Auf Events, Bands, Spielstätten, Firmen, Personen und
            Rechnungen über „Wiedervorlage“ anlegen.
          </p>
        ) : (
          <>
            {shown.length > 0 ? (
              <FollowUpList followUps={shown} showRecord />
            ) : (
              <p className="text-sm text-muted-foreground">
                In den nächsten {HORIZON_DAYS} Tagen ist nichts fällig.
              </p>
            )}
            {later > 0 && (
              <Button
                variant="link"
                className="mt-2 h-auto p-0 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setShowAll((current) => !current)}
              >
                {showAll
                  ? `Nur die nächsten ${HORIZON_DAYS} Tage`
                  : `${later} weitere später anzeigen`}
              </Button>
            )}
          </>
        )}
      </CardContent>
      <FollowUpDialog open={creating} onOpenChange={setCreating} />
    </Card>
  )
}
