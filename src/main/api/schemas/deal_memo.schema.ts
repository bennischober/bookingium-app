import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'

export const DealMemoStatus = z.enum(['pending', 'confirmed', 'cancelled'])
export type DealMemoStatus = z.infer<typeof DealMemoStatus>

/**
 * Lightweight DTO for the list view — includes joined band + venue names.
 */
export const DealMemoListItemDto = z.object({
  id: z.number(),
  deal: z.string(),
  date: z.string(),
  status: z.string(),
  bandId: z.number(),
  bandName: z.string(),
  venueId: z.number().nullable(),
  venueName: z.string().nullable()
})

export type DealMemoListItemDto = z.infer<typeof DealMemoListItemDto>

export const PaginatedDealMemoResponse = createPaginatedResponse(DealMemoListItemDto)
export type PaginatedDealMemoResponse = z.infer<typeof PaginatedDealMemoResponse>

/**
 * Full DTO for the detail/edit view.
 */
export const DealMemoDto = DealMemoListItemDto.extend({
  ticketPriceVvk: z.number().nullable(),
  ticketPriceAk: z.number().nullable(),
  posters: z.string(),
  notes: z.string(),
  amountOfPeople: z.number(),
  roomInformation: z.string(),
  performanceDuration: z.string(),
  performanceTime: z.string(),
  performanceInformation: z.string(),
  loProPersonId: z.number().nullable(),
  loProCompanyId: z.number().nullable(),
  hotelId: z.number().nullable()
}).extend(TimestampFields.shape)

export type DealMemoDto = z.infer<typeof DealMemoDto>

/**
 * Create input — Step 1 fields are required, Steps 2 + 3 are optional.
 *
 * Step 1 (required): deal name, date, band
 * Step 1 (optional): venue
 * Step 2 (optional): LoPro person + company
 * Step 3 (optional): status, ticket prices, notes
 */
export const CreateDealMemoInput = z.object({
  // Step 1 — required
  deal: z.string().min(1, 'Event name is required'),
  date: z.string().min(1, 'Date is required'),
  bandId: z.number({ error: 'Band is required' }),
  // Step 1 — optional
  venueId: z.number().nullable().optional(),
  // Step 2 — optional
  loProPersonId: z.number().nullable().optional(),
  loProCompanyId: z.number().nullable().optional(),
  // Step 3 — optional
  status: z.string().optional().default('pending'),
  ticketPriceVvk: z.number().nullable().optional(),
  ticketPriceAk: z.number().nullable().optional(),
  notes: z.string().optional().default('')
})

export type CreateDealMemoInput = z.infer<typeof CreateDealMemoInput>

export const UpdateDealMemoInput = CreateDealMemoInput.partial().extend({
  id: z.number()
})

export type UpdateDealMemoInput = z.infer<typeof UpdateDealMemoInput>
