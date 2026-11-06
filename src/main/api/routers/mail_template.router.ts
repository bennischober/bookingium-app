import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { MailTemplateService } from '../../services/MailTemplateService'
import {
  DocumentTemplateRef,
  SaveDocumentTemplateInput,
  SaveMailTemplateInput
} from '../schemas/mailTemplate.schema'

const t = initTRPC.create()
const service = container.resolve(MailTemplateService)

// #123: the user's own mail templates and the event values their placeholders take
export const mailTemplateRouter = t.router({
  list: t.procedure.query(() => service.list()),

  save: t.procedure.input(SaveMailTemplateInput).mutation(({ input }) => service.save(input)),

  delete: t.procedure.input(z.number()).mutation(({ input }) => service.delete(input)),

  event: t.procedure.input(z.number()).query(({ input }) => service.event(input)),

  // #136: the fixed texts for invoices, reminders, dunning letters and contracts
  documents: t.procedure.query(() => service.documents()),

  saveDocument: t.procedure
    .input(SaveDocumentTemplateInput)
    .mutation(({ input }) => service.saveDocument(input)),

  resetDocument: t.procedure
    .input(DocumentTemplateRef)
    .mutation(({ input }) => service.resetDocument(input))
})
