import { z } from 'zod'
import { ReceiptCategory, ReceiptDatevState } from './receipt.schema'

// #225 step 2: business trips (Reisekostenabrechnung). Amounts are integer cents.

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const TripMealsInput = z.object({
  breakfast: z.boolean(),
  lunch: z.boolean(),
  dinner: z.boolean()
})

export const TripVehicle = z.enum(['car', 'other'])
export type TripVehicle = z.infer<typeof TripVehicle>

export const TripFields = z.object({
  /** null: the default company */
  companyId: z.number().int().positive().nullable(),
  personId: z.number().int().positive().nullable(),
  travellerName: z.string().trim().min(1, 'Bitte die reisende Person angeben').max(200),
  purpose: z.string().trim().max(500).default(''),
  destination: z.string().trim().max(200).default(''),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Ländercode mit 2 Buchstaben (z. B. DE)')
    .default('DE'),
  startAt: z.string().regex(DATE_TIME, 'Beginn mit Datum und Uhrzeit'),
  endAt: z.string().regex(DATE_TIME, 'Ende mit Datum und Uhrzeit'),
  overnight: z.boolean().default(true),
  /** Per diem rates abroad; null = the domestic ones */
  ratePartialCents: z.number().int().min(0).nullable(),
  rateFullCents: z.number().int().min(0).nullable(),
  kilometres: z.number().int().min(0).max(100_000).default(0),
  vehicle: TripVehicle.default('car'),
  meals: z.record(z.string().regex(ISO_DATE), TripMealsInput).default({}),
  category: ReceiptCategory.default('other'),
  notes: z.string().trim().max(2000).default('')
})
export type TripFields = z.infer<typeof TripFields>

export const UpdateTripInput = TripFields.extend({ id: z.number().int().positive() })
export type UpdateTripInput = z.infer<typeof UpdateTripInput>

export const TripReceiptDto = z.object({
  id: z.number(),
  receiptDate: z.string().nullable(),
  supplierName: z.string(),
  fileName: z.string(),
  amountCents: z.number().nullable(),
  currency: z.string()
})
export type TripReceiptDto = z.infer<typeof TripReceiptDto>

export const TripDto = TripFields.extend({
  id: z.number(),
  companyName: z.string(),
  receipts: z.array(TripReceiptDto),
  allowancesCents: z.number(),
  mileageCents: z.number(),
  /** Receipts in euros */
  receiptsCents: z.number(),
  totalCents: z.number(),
  /** The generated report, stored as a receipt; null before the first one */
  report: z
    .object({
      receiptId: z.number(),
      fileName: z.string(),
      datev: ReceiptDatevState,
      createdAt: z.string()
    })
    .nullable(),
  updatedAt: z.string()
})
export type TripDto = z.infer<typeof TripDto>
