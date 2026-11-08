import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { clipboard } from 'electron'
import { container } from 'tsyringe'
import { ContactListService } from '../../services/ContactListService'
import {
  ContactListSource,
  RemoveContactListMemberInput,
  SaveContactListInput,
  SetNoAdvertisingInput
} from '../schemas/contactList.schema'

const t = initTRPC.create()
const service = container.resolve(ContactListService)

// Mailing and copying recompute the list here, so "Keine Werbung"
// addresses can't slip in from a stale screen
const emailsOf = (source: ContactListSource): string[] =>
  service.build(source).recipients.map((recipient) => recipient.email)

export const contactListRouter = t.router({
  build: t.procedure.input(ContactListSource).query(({ input }) => service.build(input)),

  filterOptions: t.procedure.query(() => service.filterOptions()),

  listSaved: t.procedure.query(() => service.listSaved()),

  save: t.procedure.input(SaveContactListInput).mutation(({ input }) => service.save(input)),

  deleteSaved: t.procedure.input(z.number()).mutation(({ input }) => service.deleteSaved(input)),

  /** #154: takes the records with this address off a member list */
  removeMember: t.procedure
    .input(RemoveContactListMemberInput)
    .mutation(({ input }) => service.removeMember(input.listId, input.email)),

  setNoAdvertising: t.procedure
    .input(SetNoAdvertisingInput)
    .mutation(({ input }) => service.setNoAdvertising(input.email, input.noAdvertising)),

  /** #136: the addresses for a new mail with the list in BCC, opened by the renderer */
  writeEmail: t.procedure
    .input(ContactListSource)
    .mutation(({ input }) => ({ emails: emailsOf(input) })),

  /** The addresses for pasting: ';' is split by every mail program, Outlook's included */
  copyAddresses: t.procedure.input(ContactListSource).mutation(({ input }) => {
    const emails = emailsOf(input)
    clipboard.writeText(emails.join('; '))
    return { count: emails.length }
  })
})
