import { z } from 'zod'

export const ContractPartySchema = z.object({
  id: z.number().nullable(),
  name: z.string(),
  street: z.string(),
  streetNumber: z.string(),
  zipCode: z.string(),
  city: z.string(),
  country: z.string(),
  email: z.string(),
  phone: z.string(),
  vatNumber: z.string(),
  ustNumber: z.string(),
  taxNumber: z.string(),
  kskNumber: z.string(),
  bankName: z.string(),
  accountHolder: z.string(),
  iban: z.string(),
  bic: z.string(),
  signaturePath: z.string(),
  representative: z.string()
})
export type ContractParty = z.infer<typeof ContractPartySchema>

export const ContractDataSchema = z.object({
  dealMemo: z.object({
    id: z.number(),
    name: z.string(),
    date: z.string(),
    amountOfPeople: z.number().nullable(),
    roomInformation: z.string(),
    performanceDuration: z.string(),
    performanceTime: z.string(),
    performanceInformation: z.string(),
    guaranteeAmount: z.number().nullable(),
    guaranteeVatRate: z.number().nullable(),
    contractNotes: z.string(),
    notes: z.string(),
    deal: z.string(),
    posters: z.string()
  }),
  band: z
    .object({
      id: z.number(),
      name: z.string()
    })
    .nullable(),
  artist: ContractPartySchema.nullable(),
  // Artist company's invoice logo (letterhead) - separate from the signature image
  artistLogoPath: z.string().nullable(),
  // VP1 "vertreten durch": the invoicing company (agency) when set
  representative: ContractPartySchema.nullable(),
  promoter: ContractPartySchema.nullable(),
  // Technischer Leiter (TL): explicit band field, falls back to first TL
  // band member, then to the first band member (old-repo heuristic)
  technician: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      mobilePhone: z.string(),
      phone: z.string()
    })
    .nullable(),
  venue: z
    .object({
      id: z.number(),
      name: z.string(),
      city: z.string(),
      capacity: z.number().nullable()
    })
    .nullable(),
  hotel: z
    .object({
      id: z.number(),
      name: z.string()
    })
    .nullable()
})

export type ContractData = z.infer<typeof ContractDataSchema>
