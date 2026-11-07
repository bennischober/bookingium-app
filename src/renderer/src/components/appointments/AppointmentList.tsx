import { useState } from 'react'
import { Bell, Pencil } from 'lucide-react'
import { RowActionButton } from '@/components/row-action-button'
import { RecordLink } from '@/components/follow-ups/FollowUpList'
import { AppointmentDialog } from './AppointmentDialog'
import { appointmentTimeLabel } from './appointmentDays'
import { reminderLabel } from '../../../../main/calendar/appointments'
import type { AppointmentDto } from '../../../../main/api/schemas/appointment.schema'

/** #71: own appointments (Termine) on `day` as rows: time, title, place, record, edit */
export function AppointmentList({
  appointments,
  day
}: {
  appointments: AppointmentDto[]
  /** YYYY-MM-DD: a several-day appointment shows its time on this day */
  day: string
}) {
  // Kept after closing, so the dialog doesn't change while it fades out
  const [editing, setEditing] = useState<AppointmentDto | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <ul className="divide-y">
        {appointments.map((appointment) => (
          <li key={appointment.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
            <span className="w-20 shrink-0 pt-0.5 text-xs font-medium tabular-nums text-sky-700 dark:text-sky-400">
              {appointmentTimeLabel(appointment, day)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{appointment.title}</p>
              {(appointment.place ||
                appointment.record ||
                appointment.reminderMinutes !== null) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    appointment.place && <span key="place">{appointment.place}</span>,
                    appointment.record && <RecordLink key="record" record={appointment.record} />,
                    appointment.reminderMinutes !== null && (
                      <span
                        key="reminder"
                        className="inline-flex items-center gap-1"
                        title="Erinnerung"
                      >
                        <Bell className="size-3" aria-hidden />
                        {reminderLabel(appointment.reminderMinutes, appointment.startTime === null)}
                      </span>
                    )
                  ]
                    .filter(Boolean)
                    .flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))}
                </p>
              )}
              {appointment.notes && (
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                  {appointment.notes}
                </p>
              )}
            </div>
            <RowActionButton
              icon={Pencil}
              label="Bearbeiten"
              onClick={() => {
                setEditing(appointment)
                setEditOpen(true)
              }}
            />
          </li>
        ))}
      </ul>

      <AppointmentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        appointment={editing ?? undefined}
      />
    </>
  )
}
