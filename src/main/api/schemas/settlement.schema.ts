import { z } from 'zod'

// #228: the promoter's settlement of a show (Konzertabrechnung) and the management fee from it.
// The input mirrors settlement/settlement.ts; amounts are integer cents, rates percent.

const cents = z.number().int()
const rate = z.number().min(0).max(100)

export const SettlementTicketLineInput = z.object({
  system: z.string().trim().max(200),
  category: z.string().trim().max(200),
  priceCents: cents.min(0),
  extraCents: cents,
  sold: z.number().int().min(0),
  wkzCents: cents.min(0)
})

export const SettlementInputSchema = z.object({
  lines: z.array(SettlementTicketLineInput).max(50),
  ticketVatRate: rate,
  guaranteeCents: cents.min(0),
  dealMode: z.enum(['versus', 'plus']),
  tiers: z
    .array(z.object({ percent: rate, fromCents: cents.min(0) }))
    .min(1)
    .max(4),
  gageVatRate: rate,
  costs: z.array(z.object({ label: z.string().trim().max(200), netCents: cents })).max(20),
  costsVatRate: rate,
  supportFeeCents: cents.min(0),
  supportVatRate: rate,
  advances: z.object({
    gageCents: cents.min(0),
    wkzCents: cents.min(0),
    costsCents: cents.min(0),
    supportCents: cents.min(0)
  }),
  // A settlement from abroad: the currency of all its amounts and the rate the management fee is
  // converted at (euros for one unit). Settlements stored before have none and read as EUR.
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default('EUR'),
  eurRate: z.number().positive().max(100_000).nullable().default(null),
  eurRateDate: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .default('')
})
export type SettlementInputSchema = z.infer<typeof SettlementInputSchema>

export const SaveSettlementInput = z.object({
  eventId: z.number().int().positive(),
  input: SettlementInputSchema,
  sourceFileName: z.string().default('')
})
export type SaveSettlementInput = z.infer<typeof SaveSettlementInput>

export const SettlementDto = z.object({
  eventId: z.number(),
  // The stored row, null before the first save (#262: grants name it)
  id: z.number().nullable(),
  /** null: no settlement yet */
  input: SettlementInputSchema.nullable(),
  sourceFileName: z.string(),
  updatedAt: z.string().nullable(),
  /** The band's management contract the fee is billed under, null if the band has none */
  contract: z
    .object({
      id: z.number(),
      managementCompanyName: z.string(),
      commissionPercent: z.number(),
      agencyPercent: z.number()
    })
    .nullable(),
  feeInvoice: z
    .object({ id: z.number(), invoiceNumber: z.number().nullable(), status: z.string() })
    .nullable()
})
export type SettlementDto = z.infer<typeof SettlementDto>

/** What a promoter's sheet held, before it is saved */
export const SettlementSheetDto = z.object({
  fileName: z.string(),
  input: SettlementInputSchema,
  artist: z.string(),
  date: z.string(),
  city: z.string(),
  venue: z.string(),
  promoter: z.string(),
  sheet: z.object({
    gageNetCents: z.number().nullable(),
    totalNetCents: z.number().nullable(),
    totalGrossCents: z.number().nullable()
  })
})
export type SettlementSheetDto = z.infer<typeof SettlementSheetDto>
