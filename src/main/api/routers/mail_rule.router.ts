import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { MailRuleService } from '../../services/MailRuleService'
import {
  MoveMailRuleInput,
  SaveMailRuleInput,
  SetMailRuleEnabledInput
} from '../schemas/mailRule.schema'

const t = initTRPC.create()
const service = container.resolve(MailRuleService)

// #124: rules for incoming mail; they run after each INBOX sync (src/main/index.ts)
export const mailRuleRouter = t.router({
  list: t.procedure.query(() => service.list()),

  save: t.procedure.input(SaveMailRuleInput).mutation(({ input }) => service.save(input)),

  setEnabled: t.procedure
    .input(SetMailRuleEnabledInput)
    .mutation(({ input }) => service.setEnabled(input)),

  move: t.procedure.input(MoveMailRuleInput).mutation(({ input }) => service.move(input)),

  delete: t.procedure.input(z.number()).mutation(({ input }) => service.delete(input))
})
