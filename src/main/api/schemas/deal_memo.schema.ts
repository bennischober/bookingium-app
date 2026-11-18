import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'
import { RadiusOverrideDto, RadiusOverrideInput } from './radius.schema'
import { VenueKind } from './venue.schema'

export const DealMemoStatus = z.enum(['pending', 'confirmed', 'cancelled'])
export type DealMemoStatus = z.infer<typeof DealMemoStatus>

/**
 * Lightweight DTO for the list view — includes joined band + venue names.
 */
export const DealMemoListItemDto = z.object({
  id: z.number(),
  name: z.string(),
  deal: z.string(),
  date: z.string(),
  status: z.string(),
  bandId: z.number(),
  bandName: z.string(),
  venueId: z.number().nullable(),
  venueName: z.string().nullable(),
  // The tour it belongs to, '' for none
  tour: z.string()
})

export type DealMemoListItemDto = z.infer<typeof DealMemoListItemDto>

export const PaginatedDealMemoResponse = createPaginatedResponse(DealMemoListItemDto)
export type PaginatedDealMemoResponse = z.infer<typeof PaginatedDealMemoResponse>

/**
 * Full DTO for the detail/edit view.
 */
/** One prepayment ("Vorkasse") on the fee: net euros, a null due date = on signing */
export const DealMemoDeposit = z.object({
  amount: z.number().positive(),
  dueDate: z.iso.date().nullable(),
  // #201: when it was paid; null or absent = still open
  paidAt: z.iso.date().nullable().optional()
})
export type DealMemoDeposit = z.infer<typeof DealMemoDeposit>

export const DealMemoDto = DealMemoListItemDto.extend({
  ticketPriceVvk: z.number().nullable(),
  ticketPriceAk: z.number().nullable(),
  posters: z.string(),
  notes: z.string(),
  amountOfPeople: z.number().nullable(),
  roomInformation: z.string().nullable(),
  performanceDuration: z.string().nullable(),
  performanceTime: z.string().nullable(),
  performanceInformation: z.string().nullable(),
  guaranteeAmount: z.number().nullable(),
  guaranteeVatRate: z.number().nullable(),
  // Contract "Vorkasse": prepayments on the fee, in order. Loaded by getById only;
  // the list procedures leave it empty
  deposits: z.array(DealMemoDeposit),
  contractNotes: z.string(),
  // #201: contract sent / back signed (dates), null = not yet
  contractSentAt: z.string().nullable(),
  contractReturnedAt: z.string().nullable(),
  loProPersonId: z.number().nullable(),
  loProCompanyId: z.number().nullable(),
  invoiceCompanyId: z.number().nullable(),
  // Contract "vertreten durch" override; null = band management / default
  representingCompanyId: z.number().nullable(),
  hotelId: z.number().nullable()
})
  .extend(RadiusOverrideDto.shape)
  .extend(TimestampFields.shape)

export type DealMemoDto = z.infer<typeof DealMemoDto>

/**
 * Richer DTO for the Event Hub detail view — includes nested objects for display.
 */
export const DealMemoDetailDto = DealMemoDto.extend({
  band: z
    .object({
      id: z.number(),
      name: z.string(),
      genre: z.string(),
      managementCompanyId: z.number().nullable()
    })
    .nullable(),
  venue: z
    .object({
      id: z.number(),
      name: z.string(),
      capacity: z.number().nullable(),
      // The event's radius clause falls back to these, then to the kind's default
      kind: VenueKind
    })
    .extend(RadiusOverrideDto.shape)
    .nullable(),
  hotel: z
    .object({
      id: z.number(),
      name: z.string()
    })
    .nullable(),
  loProPerson: z
    .object({
      id: z.number(),
      firstName: z.string(),
      lastName: z.string()
    })
    .nullable(),
  loProCompany: z
    .object({
      id: z.number(),
      name: z.string()
    })
    .nullable()
})

export type DealMemoDetailDto = z.infer<typeof DealMemoDetailDto>

export const CreateDealMemoInput = z.object({
  name: z.string().min(1, 'Name des Events ist erforderlich'),
  deal: z.string().optional().default(''),
  date: z.string().min(1, 'Datum ist erforderlich'),
  bandId: z.number('Band is required'),
  venueId: z.number().nullable().optional(),
  loProPersonId: z.number().nullable().optional(),
  loProCompanyId: z.number().nullable().optional(),
  invoiceCompanyId: z.number().nullable().optional(),
  representingCompanyId: z.number().nullable().optional(),
  status: z.string().optional(),
  ticketPriceVvk: z.number().nullable().optional(),
  ticketPriceAk: z.number().nullable().optional(),
  guaranteeAmount: z.number().nullable().optional(),
  guaranteeVatRate: z.number().nullable().optional(),
  contractNotes: z.string().optional(),
  notes: z.string().optional().default(''),
  tour: z.string().trim().max(200).optional()
})

export type CreateDealMemoInput = z.infer<typeof CreateDealMemoInput>

export const UpdateDealMemoInput = CreateDealMemoInput.partial()
  .omit({ name: true })
  .extend({
    name: z.string().min(1).optional(),
    id: z.number(),
    hotelId: z.number().nullable().optional(),
    posters: z.string().optional(),
    amountOfPeople: z.number().nullable().optional(),
    roomInformation: z.string().nullable().optional(),
    performanceDuration: z.string().nullable().optional(),
    performanceTime: z.string().nullable().optional(),
    performanceInformation: z.string().nullable().optional(),
    guaranteeAmount: z.number().nullable().optional(),
    guaranteeVatRate: z.number().nullable().optional(),
    // Replaces all prepayments of the event; [] clears them, absent keeps them
    deposits: z.array(DealMemoDeposit).optional(),
    contractNotes: z.string().optional(),
    contractSentAt: z.iso.date().nullable().optional(),
    contractReturnedAt: z.iso.date().nullable().optional()
  })
  .extend(RadiusOverrideInput.shape)

export type UpdateDealMemoInput = z.infer<typeof UpdateDealMemoInput>

/** #200: events picked in the list, at most what a list can hold */
const EventIds = z.array(z.number().int().positive()).min(1).max(5000)

/**
 * #200: a status per event, in one go. The answer has the same shape with the statuses they had,
 * so passing it back undoes the change ("Rückgängig")
 */
export const SetDealMemoStatusesInput = z.object({
  changes: z
    .array(z.object({ id: z.number().int().positive(), status: DealMemoStatus }))
    .min(1)
    .max(5000)
})
export type SetDealMemoStatusesInput = z.infer<typeof SetDealMemoStatusesInput>

/** #200: several events archived or restored at once */
export const DealMemoIdsInput = z.object({ ids: EventIds })
export type DealMemoIdsInput = z.infer<typeof DealMemoIdsInput>
