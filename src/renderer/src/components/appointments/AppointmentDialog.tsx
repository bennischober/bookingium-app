import { useState } from 'react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { localIsoDate } from '@/lib/followUps'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { RecordPicker } from '@/components/mail/RecordPicker'
import {
  useRecordChoices,
  type RecordChoice,
  type RecordType
} from '@/components/mail/recordChoices'
import { defaultReminder, reminderAfterSwitch, reminderOptions } from './appointmentDays'
import { appointmentTimesError, reminderLabel } from '../../../../main/calendar/appointments'
import type { AppointmentDto } from '../../../../main/api/schemas/appointment.schema'

/** The Select's value for "no reminder"; Radix refuses an empty value */
const NO_REMINDER = 'none'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this appointment; without it the dialog creates one */
  appointment?: AppointmentDto
  /** The day (YYYY-MM-DD) a new appointment is on; today without it */
  initialDate?: string
}

/** #71: create or edit an own appointment (Termin) */
export function AppointmentDialog({ open, onOpenChange, appointment, initialDate }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {/* Mounted per opening, so the form starts fresh each time */}
        <AppointmentForm
          appointment={appointment}
          initialDate={initialDate}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function AppointmentForm({
  appointment,
  initialDate,
  onDone
}: Pick<Props, 'appointment' | 'initialDate'> & { onDone: () => void }) {
  const day = initialDate ?? localIsoDate()
  const [title, setTitle] = useState(appointment?.title ?? '')
  const [allDay, setAllDay] = useState(appointment ? appointment.startTime === null : false)
  const [startDate, setStartDate] = useState(appointment?.startDate ?? day)
  const [startTime, setStartTime] = useState(appointment?.startTime ?? '10:00')
  const [endDate, setEndDate] = useState(appointment?.endDate ?? day)
  const [endTime, setEndTime] = useState(appointment?.endTime ?? '11:00')
  const [place, setPlace] = useState(appointment?.place ?? '')
  const [notes, setNotes] = useState(appointment?.notes ?? '')
  const [reminder, setReminder] = useState<number | null>(
    appointment ? appointment.reminderMinutes : defaultReminder(false)
  )
  const [link, setLink] = useState(Boolean(appointment?.record))
  const [linkType, setLinkType] = useState<RecordType>(appointment?.record?.type ?? 'event')
  const [linkChoice, setLinkChoice] = useState<RecordChoice | null>(
    appointment?.record ? { id: appointment.record.id, label: appointment.record.name } : null
  )
  const [search, setSearch] = useState('')
  const choices = useRecordChoices(linkType, search, link)
  const settings = trpcReact.settings.get.useQuery()

  const utils = trpcReact.useUtils()
  const onSuccess = (message: string) => {
    void utils.appointment.invalidate()
    toast.success(message)
    onDone()
  }
  const onError = (error: { message: string }) =>
    toast.error('Termin konnte nicht gespeichert werden', { description: error.message })

  const create = trpcReact.appointment.create.useMutation({
    onSuccess: () => onSuccess('Termin angelegt'),
    onError
  })
  const update = trpcReact.appointment.update.useMutation({
    onSuccess: () => onSuccess('Termin gespeichert'),
    onError
  })
  const remove = trpcReact.appointment.delete.useMutation({
    onSuccess: () => onSuccess('Termin gelöscht'),
    onError
  })

  const times = {
    startDate,
    startTime: allDay ? null : startTime,
    endDate,
    endTime: allDay ? null : endTime
  }
  const datesSet = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
  const timesSet = allDay || (/^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime))
  const timesError = datesSet && timesSet ? appointmentTimesError(times) : null
  const saving = create.isLoading || update.isLoading || remove.isLoading
  const valid =
    title.trim() !== '' && datesSet && timesSet && !timesError && (!link || linkChoice !== null)
  const options = reminderOptions(allDay)
  // A reminder set elsewhere stays choosable
  const offered =
    reminder === null || options.some((option) => option.minutes === reminder)
      ? options
      : [...options, { minutes: reminder, label: reminderLabel(reminder, allDay) }]

  const changeStartDate = (value: string) => {
    // The end moves along, so a one-day appointment stays on one day
    if (endDate === startDate || endDate < value) setEndDate(value)
    setStartDate(value)
  }
  const changeAllDay = (value: boolean) => {
    setAllDay(value)
    setReminder(reminderAfterSwitch(reminder, value))
  }

  const submit = () => {
    if (!valid || saving) return
    const fields = {
      title,
      ...times,
      place,
      notes,
      reminderMinutes: reminder,
      record: link && linkChoice ? { type: linkType, id: linkChoice.id } : null
    }
    if (appointment) update.mutate({ id: appointment.id, ...fields })
    else create.mutate(fields)
  }

  const handleDelete = async () => {
    if (!appointment) return
    if (
      await confirmAction({
        title: 'Termin löschen?',
        description: `„${appointment.title}“ wird aus dem Kalender entfernt.`,
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
      remove.mutate(appointment.id)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{appointment ? 'Termin bearbeiten' : 'Neuer Termin'}</DialogTitle>
        <DialogDescription>
          Ein eigener Termin im Kalender, zum Beispiel eine Besprechung oder ein Anruf.
        </DialogDescription>
      </DialogHeader>

      <div className="my-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="appointment-title">Titel</Label>
          <Input
            id="appointment-title"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="z. B. Telefonat mit dem Veranstalter"
            maxLength={200}
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch id="appointment-all-day" checked={allDay} onCheckedChange={changeAllDay} />
          <Label htmlFor="appointment-all-day">Ganztägig</Label>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="appointment-start-date" className="w-14">
              Beginn
            </Label>
            <Input
              id="appointment-start-date"
              type="date"
              value={startDate}
              onChange={(event) => changeStartDate(event.target.value)}
              className="w-44"
            />
            {!allDay && (
              <Input
                aria-label="Uhrzeit Beginn"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="w-28"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="appointment-end-date" className="w-14">
              Ende
            </Label>
            <Input
              id="appointment-end-date"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-44"
            />
            {!allDay && (
              <Input
                aria-label="Uhrzeit Ende"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className="w-28"
              />
            )}
          </div>
        </div>
        {timesError && <p className="text-sm text-destructive">{timesError}</p>}

        <div className="space-y-2">
          <Label htmlFor="appointment-place">Ort</Label>
          <Input
            id="appointment-place"
            value={place}
            onChange={(event) => setPlace(event.target.value)}
            placeholder="Adresse, Raum oder Link"
            maxLength={500}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="appointment-reminder">Erinnerung</Label>
          <Select
            value={reminder === null ? NO_REMINDER : String(reminder)}
            onValueChange={(value) => setReminder(value === NO_REMINDER ? null : Number(value))}
          >
            <SelectTrigger id="appointment-reminder" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_REMINDER}>Keine</SelectItem>
              {offered.map((option) => (
                <SelectItem key={option.minutes} value={String(option.minutes)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {reminder !== null && settings.data && !settings.data.reminderNotifications && (
            <p className="text-xs text-muted-foreground">
              Erinnerungen sind unter Einstellungen → Benachrichtigungen ausgeschaltet.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="appointment-link"
              checked={link}
              onCheckedChange={(value) => {
                setLink(value)
                if (!value) setLinkChoice(null)
              }}
            />
            <Label htmlFor="appointment-link">Zu einem Datensatz</Label>
          </div>
          {link && (
            <div className="space-y-3 pl-6">
              <RecordPicker
                idPrefix="appointment-record"
                typeLabel="Datensatz"
                type={linkType}
                onTypeChange={(next) => {
                  setLinkType(next)
                  setLinkChoice(null)
                }}
                search={search}
                onSearchChange={setSearch}
                choices={choices}
                selected={linkChoice}
                onChoose={setLinkChoice}
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="appointment-notes">Notizen</Label>
          <Textarea
            id="appointment-notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl+Enter saves; Enter alone makes a new line
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                submit()
              }
            }}
          />
        </div>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {appointment ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void handleDelete()}
            disabled={saving}
          >
            Löschen
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            Speichern
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
