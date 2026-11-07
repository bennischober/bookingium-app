import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { AppointmentService } from '../../services/AppointmentService'
import {
  AppointmentByIcalUidInput,
  CreateAppointmentInput,
  ListAppointmentsInput,
  UpdateAppointmentInput
} from '../schemas/appointment.schema'

const t = initTRPC.create()
const service = container.resolve(AppointmentService)

/** #71: own appointments (Termine) in the calendar */
export const appointmentRouter = t.router({
  listBetween: t.procedure
    .input(ListAppointmentsInput)
    .query(({ input }) => service.listBetween(input.from, input.to)),

  /** #71: the appointment an invitation was taken over as, so taking it over again updates it */
  byIcalUid: t.procedure
    .input(AppointmentByIcalUidInput)
    .query(({ input }) => service.getByIcalUid(input.uid)),

  create: t.procedure.input(CreateAppointmentInput).mutation(({ input }) => service.create(input)),

  update: t.procedure.input(UpdateAppointmentInput).mutation(({ input }) => service.update(input)),

  delete: t.procedure.input(z.number().int()).mutation(({ input }) => service.delete(input))
})
