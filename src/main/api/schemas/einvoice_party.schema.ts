import { z } from 'zod'
import { AddressInput } from './address.schema'

// #222: a company and its people from a received e-invoice. The file is read in main (a
// dropped or picked path, or a mail attachment); the renderer gets what was read, lets the
// user correct it and add people, and sends it back to be written.

/** Where the e-invoice comes from */
export const EInvoicePartySource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().min(1) }),
  z.object({
    kind: z.literal('attachment'),
    accountId: z.string().min(1),
    messageId: z.number().int().positive(),
    partId: z.string().min(1)
  })
])
export type EInvoicePartySource = z.infer<typeof EInvoicePartySource>

/** Role suggestions for the people of a company; the role itself stays free text */
export const COMPANY_MEMBER_ROLE_SUGGESTIONS = ['Kontakt', 'Geschäftsführer'] as const

export const EInvoicePartyPersonInput = z.object({
  firstName: z.string().trim().min(1, 'Vorname ist erforderlich'),
  lastName: z.string().trim().default(''),
  email: z.string().trim().email('Ungültige E-Mail-Adresse').or(z.literal('')).default(''),
  phone: z.string().trim().default(''),
  role: z.string().trim().default('')
})
export type EInvoicePartyPersonInput = z.infer<typeof EInvoicePartyPersonInput>

/** The company and people as the user confirms them */
export const EInvoicePartyInput = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich'),
  vatId: z.string().trim().default(''),
  taxNumber: z.string().trim().default(''),
  commercialRegisterNo: z.string().trim().default(''),
  registerCourt: z.string().trim().default(''),
  email: z.string().trim().email('Ungültige E-Mail-Adresse').or(z.literal('')).default(''),
  phone: z.string().trim().default(''),
  address: AddressInput,
  bank: z.object({
    iban: z.string().trim().default(''),
    bic: z.string().trim().default(''),
    accountHolder: z.string().trim().default('')
  }),
  persons: z.array(EInvoicePartyPersonInput)
})
export type EInvoicePartyInput = z.infer<typeof EInvoicePartyInput>

/** What a record of the e-invoice matched in the app */
export const EInvoicePartyMatch = z
  .object({
    id: z.number(),
    name: z.string(),
    by: z.enum(['vatId', 'taxNumber', 'name', 'email'])
  })
  .nullable()
export type EInvoicePartyMatch = z.infer<typeof EInvoicePartyMatch>

export const EInvoicePartyPreview = z.object({
  fileName: z.string(),
  invoiceNumber: z.string(),
  issueDate: z.string(),
  party: EInvoicePartyInput,
  company: EInvoicePartyMatch,
  /** Same order as party.persons */
  persons: z.array(
    z.object({
      match: EInvoicePartyMatch,
      /** Already linked to the matched company */
      isMember: z.boolean()
    })
  )
})
export type EInvoicePartyPreview = z.infer<typeof EInvoicePartyPreview>

export const EInvoicePartyResult = z.object({
  companyId: z.number(),
  companyCreated: z.boolean(),
  companyUpdated: z.boolean(),
  personsCreated: z.number(),
  personsUpdated: z.number(),
  membersAdded: z.number()
})
export type EInvoicePartyResult = z.infer<typeof EInvoicePartyResult>
