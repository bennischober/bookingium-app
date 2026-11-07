import { AppointmentDialog } from '@/components/appointments/AppointmentDialog'
import type { Invitation } from '../../../../main/calendar/invitation'
import type { AppointmentDto } from '../../../../main/api/schemas/appointment.schema'

/** An invitation read from a mail, with the appointment it was taken over as before */
export type InvitationToTake = { invitation: Invitation; existing: AppointmentDto | null }

/**
 * #71: "Als Termin übernehmen". The appointment dialog opens with what the invitation says;
 * taken over before (same UID), saving updates that appointment instead of adding a second one.
 * Only the app's data changes, so read-only accounts offer it too.
 */
export function InvitationFromMail({
  taking,
  onClose
}: {
  taking: InvitationToTake
  onClose: () => void
}) {
  return (
    <AppointmentDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      appointment={taking.existing ?? undefined}
      invitation={taking.invitation}
    />
  )
}
