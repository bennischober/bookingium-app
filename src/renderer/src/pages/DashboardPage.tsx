import { useMemo } from 'react'
import { addDays, endOfDay, endOfMonth, isWithinInterval, parseISO, startOfDay, startOfMonth } from 'date-fns'
import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/main'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

export default function DashboardPage() {
  const navigate = useNavigate()

  const eventsQuery = trpcReact.dealMemo.getAllPaginated.useQuery({
    page: 1,
    pageSize: 500,
    search: undefined
  })

  const bandsQuery = trpcReact.band.getAll.useQuery()
  const venuesQuery = trpcReact.venue.getAll.useQuery()
  const companiesQuery = trpcReact.company.getAll.useQuery()

  const now = new Date()

  const parsedEvents = useMemo(() => {
    return (eventsQuery.data?.items ?? [])
      .map((event) => ({
        ...event,
        parsedDate: parseISO(event.date)
      }))
      .filter((event) => !Number.isNaN(event.parsedDate.getTime()))
      .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime())
  }, [eventsQuery.data?.items])

  const upcomingNext7Days = useMemo(() => {
    const start = startOfDay(now)
    const end = endOfDay(addDays(now, 7))

    return parsedEvents.filter(
      (event) =>
        event.status !== 'cancelled' &&
        isWithinInterval(event.parsedDate, { start, end })
    )
  }, [parsedEvents, now])

  const pendingEventsCount = useMemo(
    () => parsedEvents.filter((event) => event.status === 'pending').length,
    [parsedEvents]
  )

  const eventsThisMonthCount = useMemo(() => {
    const start = startOfMonth(now)
    const end = endOfMonth(now)
    return parsedEvents.filter((event) => isWithinInterval(event.parsedDate, { start, end })).length
  }, [parsedEvents, now])

  const latestUpcoming = upcomingNext7Days.slice(0, 6)

  const isDirectoryLoading =
    bandsQuery.isLoading || venuesQuery.isLoading || companiesQuery.isLoading

  return (
    <div className="flex flex-col w-full h-full p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          High-level overview of your bookings and operational data.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Upcoming Gigs (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{upcomingNext7Days.length}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Non-cancelled events from today through next week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pending Confirmations</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingEventsCount}</p>
            <p className="text-sm text-muted-foreground mt-1">Events with pending status</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Events This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{eventsThisMonthCount}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Events scheduled in the current month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Unpaid Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">-</p>
            <p className="text-sm text-muted-foreground mt-1">
              Invoice tracking is not implemented yet
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Upcoming Agenda</CardTitle>
            <Button variant="outline" onClick={() => navigate({ to: '/calendar' })}>
              Open Calendar
            </Button>
          </CardHeader>
          <CardContent>
            {eventsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading upcoming events...</p>
            ) : latestUpcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming gigs in the next 7 days.</p>
            ) : (
              <div className="space-y-3">
                {latestUpcoming.map((event) => (
                  <div
                    key={event.id}
                    className="border rounded-lg p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{event.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {event.parsedDate.toLocaleDateString('de-DE', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric'
                        })}{' '}
                        - {event.bandName} {event.venueName ? `@ ${event.venueName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn('capitalize', STATUS_STYLES[event.status] ?? '')}>
                        {event.status || 'pending'}
                      </Badge>
                      <Button
                        variant="outline"
                        onClick={() =>
                          navigate({
                            to: '/events/$eventId',
                            params: { eventId: String(event.id) }
                          })
                        }
                      >
                        Open Event
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Directory Overview</CardTitle>
          </CardHeader>
          <CardContent>
            {isDirectoryLoading ? (
              <p className="text-sm text-muted-foreground">Loading directory stats...</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Bands</span>
                  <span className="font-semibold">{bandsQuery.data?.length ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Venues</span>
                  <span className="font-semibold">{venuesQuery.data?.length ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Companies</span>
                  <span className="font-semibold">{companiesQuery.data?.length ?? 0}</span>
                </div>
                <div className="pt-2">
                  <Button className="w-full" variant="outline" onClick={() => navigate({ to: '/events' })}>
                    Manage Events
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
