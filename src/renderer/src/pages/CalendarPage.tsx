import { useEffect, useMemo, useState } from 'react'
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
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Calendar } from '@/components/ui/calendar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreateEventWizard } from '@/components/forms/CreateEventWizard'
import { FollowUpDialog } from '@/components/follow-ups/FollowUpDialog'
import { FollowUpList } from '@/components/follow-ups/FollowUpList'
import { AppointmentDialog } from '@/components/appointments/AppointmentDialog'
import { AppointmentList } from '@/components/appointments/AppointmentList'
import { appointmentsByDay } from '@/components/appointments/appointmentDays'
import { cn } from '@/lib/utils'
import { trpcReact } from '@/lib/trpc'
import type { FollowUpDto } from '../../../main/api/schemas/followUp.schema'

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
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [appointmentOpen, setAppointmentOpen] = useState(false)

  // #71: an appointment's reminder opens the calendar on its day (?day=); taken over once, then
  // dropped from the URL, so the same day can be asked for again
  const { day: requestedDay } = useSearch({ strict: false }) as { day?: string }
  // Taken over while rendering (React's "adjust state on a prop change"), not in an effect
  const [takenDay, setTakenDay] = useState<string>()
  if (requestedDay !== takenDay) {
    setTakenDay(requestedDay)
    const date = requestedDay ? parseISO(requestedDay) : null
    if (date && !Number.isNaN(date.getTime())) {
      setSelectedDate(date)
      setCalendarMonth(startOfMonth(date))
      setViewMode('day')
    }
  }
  useEffect(() => {
    if (requestedDay) void navigate({ to: '/calendar', search: {}, replace: true })
  }, [requestedDay, navigate])

  const events = trpcReact.dealMemo.getAllPaginated.useQuery({
    page: 1,
    pageSize: 100,
    search: undefined
  })

  // #52: open follow-ups (Wiedervorlagen) on their due day, next to the events
  const followUps = trpcReact.followUp.listOpen.useQuery()
  const followUpsByDay = useMemo(() => {
    const byDay = new Map<string, FollowUpDto[]>()
    for (const followUp of followUps.data ?? []) {
      byDay.set(followUp.dueDate, [...(byDay.get(followUp.dueDate) ?? []), followUp])
    }
    return byDay
  }, [followUps.data])

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

  // The days of the chosen range, as yyyy-MM-dd
  const range = useMemo(() => {
    if (viewMode === 'day') {
      const day = format(selectedDate, 'yyyy-MM-dd')
      return { start: day, end: day }
    }
    if (viewMode === 'week') {
      return {
        start: format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        end: format(endOfWeek(selectedDate, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      }
    }
    return {
      start: format(startOfMonth(activeMonthDate), 'yyyy-MM-dd'),
      end: format(endOfMonth(activeMonthDate), 'yyyy-MM-dd')
    }
  }, [viewMode, selectedDate, activeMonthDate])

  // #71: own appointments on the days the month grid shows and the agenda lists
  const appointmentRange = useMemo(() => {
    const gridStart = format(
      startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 1 }),
      'yyyy-MM-dd'
    )
    const gridEnd = format(endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    return {
      from: range.start < gridStart ? range.start : gridStart,
      to: range.end > gridEnd ? range.end : gridEnd
    }
  }, [calendarMonth, range])
  const appointments = trpcReact.appointment.listBetween.useQuery(appointmentRange, {
    keepPreviousData: true
  })
  const appointmentsOnDay = useMemo(
    () => appointmentsByDay(appointments.data ?? [], appointmentRange.from, appointmentRange.to),
    [appointments.data, appointmentRange]
  )

  const groupedAgenda = useMemo(() => {
    const groups = new Map<string, typeof filteredEvents>()

    filteredEvents.forEach((event) => {
      const key = format(event.parsedDate, 'yyyy-MM-dd')
      const existing = groups.get(key) ?? []
      groups.set(key, [...existing, event])
    })
    // Days with only follow-ups or appointments get a group too
    for (const dayKey of [...followUpsByDay.keys(), ...appointmentsOnDay.keys()]) {
      if (dayKey >= range.start && dayKey <= range.end && !groups.has(dayKey)) {
        groups.set(dayKey, [])
      }
    }

    return Array.from(groups.entries())
      .sort((a, b) => compareAsc(parseISO(a[0]), parseISO(b[0])))
      .map(([dayKey, dayEvents]) => ({
        dayKey,
        dayLabel: format(parseISO(dayKey), 'EEEE, dd. MMMM yyyy', { locale: de }),
        items: dayEvents.sort((a, b) => compareAsc(a.parsedDate, b.parsedDate)),
        followUps: followUpsByDay.get(dayKey) ?? [],
        appointments: appointmentsOnDay.get(dayKey) ?? []
      }))
  }, [filteredEvents, followUpsByDay, appointmentsOnDay, range])

  const highlightedDates = useMemo(() => {
    return new Set(eventsWithParsedDate.map((event) => format(event.parsedDate, 'yyyy-MM-dd')))
  }, [eventsWithParsedDate])

  const selectedKey = format(selectedDate, 'yyyy-MM-dd')
  const selectedDayFollowUps = followUpsByDay.get(selectedKey) ?? []
  const selectedDayAppointments = appointmentsOnDay.get(selectedKey) ?? []
  const openEvent = (id: number) =>
    navigate({ to: '/events/$eventId', params: { eventId: String(id) } })

  return (
    <div className="flex flex-col w-full h-full p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Kalender</h1>
        <p className="text-sm text-muted-foreground">
          Tag anklicken, um seine Events, Termine und Wiedervorlagen zu sehen oder dort etwas Neues
          anzulegen (Doppelklick legt direkt ein Event an).
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
                hasEvent: (date) => highlightedDates.has(format(date, 'yyyy-MM-dd')),
                hasFollowUp: (date) => followUpsByDay.has(format(date, 'yyyy-MM-dd')),
                hasAppointment: (date) => appointmentsOnDay.has(format(date, 'yyyy-MM-dd'))
              }}
              modifiersClassNames={{
                hasEvent:
                  'font-semibold underline decoration-primary decoration-2 underline-offset-4',
                // A small amber dot in the corner: a follow-up is due that day
                hasFollowUp:
                  'relative after:pointer-events-none after:absolute after:right-1.5 after:top-1.5 after:size-1.5 after:rounded-full after:bg-amber-500',
                // #71: a sky-blue dot in the other corner: an own appointment that day
                hasAppointment:
                  'relative before:pointer-events-none before:absolute before:left-1.5 before:top-1.5 before:size-1.5 before:rounded-full before:bg-sky-500'
              }}
            />

            {/* The selected day: its events and a quick create */}
            <div className="mt-4 space-y-3 border-t pt-4" data-testid="selected-day">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">
                  {format(selectedDate, 'EEEE, dd.MM.yyyy', { locale: de })}
                </p>
                {/* "+" as text like the other create buttons: the thin Plus icon
                    sat visibly higher than the text in this font */}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setFollowUpOpen(true)}>
                    + Wiedervorlage
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAppointmentOpen(true)}>
                    + Termin
                  </Button>
                  <Button size="sm" onClick={() => setWizardOpen(true)}>
                    + Event anlegen
                  </Button>
                </div>
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
              {selectedDayAppointments.length > 0 && (
                <section aria-label="Termine an diesem Tag" className="space-y-2 pt-1">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Termine
                  </h3>
                  <AppointmentList appointments={selectedDayAppointments} day={selectedKey} />
                </section>
              )}
              {selectedDayFollowUps.length > 0 && (
                <section aria-label="Wiedervorlagen an diesem Tag" className="space-y-2 pt-1">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Wiedervorlagen
                  </h3>
                  <FollowUpList followUps={selectedDayFollowUps} showRecord />
                </section>
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
              <p className="text-sm text-muted-foreground">Events werden geladen…</p>
            ) : groupedAgenda.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine Events, Termine oder Wiedervorlagen für diese Auswahl.
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
                        {group.appointments.length > 0 && (
                          <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 dark:border-sky-900/60 dark:bg-sky-950/20">
                            <AppointmentList appointments={group.appointments} day={group.dayKey} />
                          </div>
                        )}
                        {group.followUps.length > 0 && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                            <FollowUpList followUps={group.followUps} showRecord />
                          </div>
                        )}
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
      <FollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        initialDueDate={selectedKey}
      />
      <AppointmentDialog
        open={appointmentOpen}
        onOpenChange={setAppointmentOpen}
        initialDate={selectedKey}
      />
    </div>
  )
}
