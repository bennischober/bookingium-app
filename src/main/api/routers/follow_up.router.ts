import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { FollowUpService } from '../../services/FollowUpService'
import {
  CreateFollowUpInput,
  FollowUpRecord,
  SetFollowUpDoneInput,
  UpdateFollowUpInput
} from '../schemas/followUp.schema'

const t = initTRPC.create()
const service = container.resolve(FollowUpService)

export const followUpRouter = t.router({
  listOpen: t.procedure.query(() => service.listOpen()),

  listOpenByRecord: t.procedure
    .input(FollowUpRecord)
    .query(({ input }) => service.listOpenByRecord(input.type, input.id)),

  create: t.procedure.input(CreateFollowUpInput).mutation(({ input }) => service.create(input)),

  update: t.procedure.input(UpdateFollowUpInput).mutation(({ input }) => service.update(input)),

  setDone: t.procedure
    .input(SetFollowUpDoneInput)
    .mutation(({ input }) => service.setDone(input.id, input.done)),

  delete: t.procedure.input(z.number()).mutation(({ input }) => service.delete(input))
})
