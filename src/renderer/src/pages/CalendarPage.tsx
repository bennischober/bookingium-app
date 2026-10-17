import { useMemo, useState } from 'react'
import {
  compareAsc,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import { de } from 'date-fns/locale'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreateEventWizard } from '@/components/forms/CreateEventWizard'
import { cn } from '@/lib/utils'
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
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [calendarMonth, setCalendarMonth] = useState<Date>(startOfMonth(new Date()))
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('month')
  const [wizardOpen, setWizardOpen] = useState(false)

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

  const selectedDayEvents = useMemo(
    () => eventsWithParsedDate.filter((event) => isSameDay(event.parsedDate, selectedDate)),
    [eventsWithParsedDate, selectedDate]
  )

  const filteredEvents = useMemo(() => {
    if (viewMode === 'day') return selectedDayEvents

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
  }, [eventsWithParsedDate, selectedDayEvents, selectedDate, viewMode, activeMonthDate])

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
        dayLabel: format(parseISO(dayKey), 'EEEE, dd. MMMM yyyy', { locale: de }),
        items: dayEvents.sort((a, b) => compareAsc(a.parsedDate, b.parsedDate))
      }))
  }, [filteredEvents])

  const highlightedDates = useMemo(() => {
    return new Set(eventsWithParsedDate.map((event) => format(event.parsedDate, 'yyyy-MM-dd')))
  }, [eventsWithParsedDate])

  const selectedKey = format(selectedDate, 'yyyy-MM-dd')
  const openEvent = (id: number) =>
    navigate({ to: '/events/$eventId', params: { eventId: String(id) } })

  return (
    <div className="flex flex-col w-full h-full p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Kalender</h1>
        <p className="text-sm text-muted-foreground">
          Tag anklicken, um seine Events zu sehen oder dort ein neues Event anzulegen (Doppelklick
          legt direkt an).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Event-Kalender</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Calendar
              mode="single"
              required
              locale={de}
              weekStartsOn={1}
              selected={selectedDate}
              onSelect={(date) => {
                setSelectedDate(date)
                if (!isSameMonth(date, calendarMonth)) setCalendarMonth(startOfMonth(date))
              }}
              month={calendarMonth}
              onMonthChange={(month) => setCalendarMonth(startOfMonth(month))}
              // A double click (second click of it) creates an event on the day
              onDayClick={(date, _modifiers, e) => {
                if (e.detail === 2) {
                  setSelectedDate(date)
                  setWizardOpen(true)
                }
              }}
              className="w-full"
              modifiers={{
                hasEvent: (date) => highlightedDates.has(format(date, 'yyyy-MM-dd'))
              }}
              modifiersClassNames={{
                hasEvent:
                  'font-semibold underline decoration-primary decoration-2 underline-offset-4'
              }}
            />

            {/* The selected day: its events and a quick create */}
            <div className="mt-4 space-y-3 border-t pt-4" data-testid="selected-day">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">
                  {format(selectedDate, 'EEEE, dd.MM.yyyy', { locale: de })}
                </p>
                <Button size="sm" className="gap-1.5" onClick={() => setWizardOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Event anlegen
                </Button>
              </div>
              {selectedDayEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Events an diesem Tag.</p>
              ) : (
                <div className="space-y-2">
                  {selectedDayEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => openEvent(event.id)}
                      className="w-full rounded-md border px-3 py-2 text-left hover:bg-muted"
                    >
                      <p className="text-sm font-medium">{event.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.bandName} {event.venueName ? `@ ${event.venueName}` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle>
                {viewMode === 'day'
                  ? `Agenda für den ${format(selectedDate, 'dd.MM.yyyy')}`
                  : viewMode === 'week'
                    ? `Agenda für die Woche vom ${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'dd.MM.yyyy')}`
                    : `Agenda für ${format(activeMonthDate, 'MMMM yyyy', { locale: de })}`}
              </CardTitle>
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
                {groupedAgenda.map((group) => {
                  const isSelected = group.dayKey === selectedKey
                  return (
                    <section key={group.dayKey} className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setSelectedDate(parseISO(group.dayKey))}
                        className={cn(
                          'text-sm font-semibold hover:underline',
                          isSelected ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {group.dayLabel}
                        {isSelected && ' · ausgewählt'}
                      </button>

                      <div className="space-y-3">
                        {group.items.map((event) => (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => openEvent(event.id)}
                            className={cn(
                              'w-full rounded-lg border p-4 text-left hover:bg-muted/50',
                              isSelected && 'border-primary/50'
                            )}
                          >
                            <div className="space-y-1">
                              <p className="font-medium">{event.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {event.bandName} {event.venueName ? `@ ${event.venueName}` : ''}
                              </p>
                              <Badge
                                variant="outline"
                                className={STATUS_STYLES[event.status] ?? ''}
                              >
                                {STATUS_LABELS[event.status || 'pending'] ?? event.status}
                              </Badge>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateEventWizard
        isOpen={wizardOpen}
        initialDate={selectedKey}
        onClose={() => setWizardOpen(false)}
        onSuccess={(memo) => {
          setWizardOpen(false)
          openEvent(memo.id)
        }}
      />
    </div>
  )
}
