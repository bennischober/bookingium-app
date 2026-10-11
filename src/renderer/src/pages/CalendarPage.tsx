import { useMemo, useState } from 'react'
import {
  compareAsc,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import { useNavigate } from '@tanstack/react-router'
import { Calendar } from '@/components/ui/calendar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trpcReact } from '@/lib/trpc'

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  cancelled: 'Storniert'
}

export default function CalendarPage() {
  const navigate = useNavigate()
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())
  const [calendarMonth, setCalendarMonth] = useState<Date>(startOfMonth(new Date()))
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('month')

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

  const activeMonthDate = useMemo(() => startOfMonth(calendarMonth), [calendarMonth])

  const filteredEvents = useMemo(() => {
    if (!selectedDate) return []

    if (viewMode === 'day') {
      return eventsWithParsedDate.filter((event) => isSameDay(event.parsedDate, selectedDate))
    }

    if (viewMode === 'week') {
      const start = startOfWeek(selectedDate, { weekStartsOn: 1 })
      const end = endOfWeek(selectedDate, { weekStartsOn: 1 })
      return eventsWithParsedDate.filter((event) =>
        isWithinInterval(event.parsedDate, { start, end })
      )
    }

    const start = startOfMonth(activeMonthDate)
    const end = endOfMonth(activeMonthDate)
    return eventsWithParsedDate.filter((event) =>
      isWithinInterval(event.parsedDate, { start, end })
    )
  }, [eventsWithParsedDate, selectedDate, viewMode, activeMonthDate])

  const groupedAgenda = useMemo(() => {
    const groups = new Map<string, typeof filteredEvents>()

    filteredEvents.forEach((event) => {
      const key = format(event.parsedDate, 'yyyy-MM-dd')
      const existing = groups.get(key) ?? []
      groups.set(key, [...existing, event])
    })

    return Array.from(groups.entries())
      .sort((a, b) => compareAsc(parseISO(a[0]), parseISO(b[0])))
      .map(([dayKey, dayEvents]) => ({
        dayKey,
        dayLabel: format(parseISO(dayKey), 'EEEE, dd MMMM yyyy'),
        items: dayEvents.sort((a, b) => compareAsc(a.parsedDate, b.parsedDate))
      }))
  }, [filteredEvents])

  const highlightedDates = useMemo(() => {
    return new Set(eventsWithParsedDate.map((event) => format(event.parsedDate, 'yyyy-MM-dd')))
  }, [eventsWithParsedDate])

  return (
    <div className="flex flex-col w-full h-full p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Kalender</h1>
        <p className="text-sm text-muted-foreground">
          Anstehende Events sehen und direkt zum Event-Hub springen.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle>Event-Kalender</CardTitle>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Tabs
                  value={viewMode}
                  onValueChange={(value) => setViewMode(value as 'day' | 'week' | 'month')}
                >
                  <TabsList>
                    <TabsTrigger value="day">Tag</TabsTrigger>
                    <TabsTrigger value="week">Woche</TabsTrigger>
                    <TabsTrigger value="month">Monat</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                setSelectedDate(date)
                if (date) {
                  setCalendarMonth(startOfMonth(date))
                }
              }}
              month={calendarMonth}
              onMonthChange={(month) => setCalendarMonth(startOfMonth(month))}
              className="w-full"
              modifiers={{
                hasEvent: (date) => highlightedDates.has(format(date, 'yyyy-MM-dd'))
              }}
              modifiersClassNames={{
                hasEvent:
                  'font-semibold underline decoration-primary decoration-2 underline-offset-4'
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {viewMode === 'day' && selectedDate
                ? `Agenda für den ${format(selectedDate, 'dd.MM.yyyy')}`
                : viewMode === 'week' && selectedDate
                  ? `Agenda für die Woche vom ${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'dd.MM.yyyy')}`
                  : `Agenda für ${format(activeMonthDate, 'MMMM yyyy')}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.isLoading ? (
              <p className="text-sm text-muted-foreground">Events werden geladen...</p>
            ) : groupedAgenda.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine Events für diese Auswahl geplant.
              </p>
            ) : (
              <div className="space-y-5">
                {groupedAgenda.map((group) => (
                  <section key={group.dayKey} className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      {group.dayLabel}
                    </h3>

                    <div className="space-y-3">
                      {group.items.map((event) => (
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
                              {STATUS_LABELS[event.status || 'pending'] ?? event.status}
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
                            Event öffnen
                          </Button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
