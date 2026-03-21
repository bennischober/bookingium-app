import { useMemo, useState } from 'react'
import { format, isSameDay, parseISO } from 'date-fns'
import { useNavigate } from '@tanstack/react-router'
import { Calendar } from '@/components/ui/calendar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { trpcReact } from '@/main'

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

export default function CalendarPage() {
  const navigate = useNavigate()
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())

  const events = trpcReact.dealMemo.getAllPaginated.useQuery({
    page: 1,
    pageSize: 100,
    search: undefined
  })

  const eventsWithParsedDate = useMemo(() => {
    return (events.data?.items ?? [])
      .map((event) => ({
        ...event,
        parsedDate: parseISO(event.date)
      }))
      .filter((event) => !Number.isNaN(event.parsedDate.getTime()))
      .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime())
  }, [events.data])

  const highlightedDates = useMemo(() => {
    return new Set(eventsWithParsedDate.map((event) => format(event.parsedDate, 'yyyy-MM-dd')))
  }, [eventsWithParsedDate])

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return []
    return eventsWithParsedDate.filter((event) => isSameDay(event.parsedDate, selectedDate))
  }, [eventsWithParsedDate, selectedDate])

  return (
    <div className="flex flex-col w-full h-full p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          See upcoming events and jump directly into the event hub.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Event Calendar</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              className="w-full"
              modifiers={{
                hasEvent: (date) => highlightedDates.has(format(date, 'yyyy-MM-dd'))
              }}
              modifiersClassNames={{
                hasEvent: 'font-semibold underline decoration-primary decoration-2 underline-offset-4'
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {selectedDate
                ? `Events on ${format(selectedDate, 'dd.MM.yyyy')}`
                : 'Select a date'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading events...</p>
            ) : selectedDayEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events scheduled for this day.</p>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="border rounded-lg p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{event.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {event.bandName} {event.venueName ? `@ ${event.venueName}` : ''}
                      </p>
                      <Badge variant="outline" className={STATUS_STYLES[event.status] ?? ''}>
                        {event.status || 'pending'}
                      </Badge>
                    </div>
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
