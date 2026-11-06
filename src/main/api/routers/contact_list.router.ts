import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { clipboard } from 'electron'
import { container } from 'tsyringe'
import { ContactListService } from '../../services/ContactListService'
import {
  ContactListFilters,
  SaveContactListInput,
  SetNoAdvertisingInput
} from '../schemas/contactList.schema'

const t = initTRPC.create()
const service = container.resolve(ContactListService)

// Mailing and copying recompute the list here, so "Keine Werbung"
// addresses can't slip in from a stale screen
const emailsOf = (filters: ContactListFilters): string[] =>
  service.build(filters).recipients.map((recipient) => recipient.email)

export const contactListRouter = t.router({
  build: t.procedure.input(ContactListFilters).query(({ input }) => service.build(input)),

  filterOptions: t.procedure.query(() => service.filterOptions()),

  listSaved: t.procedure.query(() => service.listSaved()),

  save: t.procedure.input(SaveContactListInput).mutation(({ input }) => service.save(input)),

  deleteSaved: t.procedure.input(z.number()).mutation(({ input }) => service.deleteSaved(input)),

  setNoAdvertising: t.procedure
    .input(SetNoAdvertisingInput)
    .mutation(({ input }) => service.setNoAdvertising(input.email, input.noAdvertising)),

  /** #136: the addresses for a new mail with the list in BCC, opened by the renderer */
  writeEmail: t.procedure
    .input(ContactListFilters)
    .mutation(({ input }) => ({ emails: emailsOf(input) })),

  /** The addresses for pasting: ';' is split by every mail program, Outlook's included */
  copyAddresses: t.procedure.input(ContactListFilters).mutation(({ input }) => {
    const emails = emailsOf(input)
    clipboard.writeText(emails.join('; '))
    return { count: emails.length }
  })
})
