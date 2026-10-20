import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { clipboard } from 'electron'
import { container } from 'tsyringe'
import { ContactListService } from '../../services/ContactListService'
import { SettingsService } from '../../services/SettingsService'
import { mailAddressSeparator, openBccEmail } from '../../mail/openEmail'
import {
  ContactListFilters,
  SaveContactListInput,
  SetNoAdvertisingInput
} from '../schemas/contactList.schema'

const t = initTRPC.create()
const service = container.resolve(ContactListService)
const settingsService = container.resolve(SettingsService)

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

  /** New email with the list in BCC; too many for a link: addresses copied */
  writeEmail: t.procedure.input(ContactListFilters).mutation(async ({ input }) => {
    const emails = emailsOf(input)
    if (emails.length === 0) return { count: 0, withRecipients: false }
    const withRecipients = await openBccEmail(emails, settingsService.get().mailProgram)
    return { count: emails.length, withRecipients }
  }),

  /** The addresses, separated the way the mail program expects */
  copyAddresses: t.procedure.input(ContactListFilters).mutation(async ({ input }) => {
    const emails = emailsOf(input)
    const separator = await mailAddressSeparator(settingsService.get().mailProgram)
    clipboard.writeText(emails.join(`${separator} `))
    return { count: emails.length }
  })
})
