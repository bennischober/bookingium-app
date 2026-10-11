import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'

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
  amountOfPeople: z.number().nullable(),
  roomInformation: z.string().nullable(),
  performanceDuration: z.string().nullable(),
  performanceTime: z.string().nullable(),
  performanceInformation: z.string().nullable(),
  guaranteeAmount: z.number().nullable(),
  guaranteeVatRate: z.number().nullable(),
  contractNotes: z.string(),
  loProPersonId: z.number().nullable(),
  loProCompanyId: z.number().nullable(),
  invoiceCompanyId: z.number().nullable(),
  hotelId: z.number().nullable()
}).extend(TimestampFields.shape)

export type DealMemoDto = z.infer<typeof DealMemoDto>

/**
 * Richer DTO for the Event Hub detail view — includes nested objects for display.
 */
export const DealMemoDetailDto = DealMemoDto.extend({
  band: z
    .object({
      id: z.number(),
      name: z.string(),
      genre: z.string()
    })
    .nullable(),
  venue: z
    .object({
      id: z.number(),
      name: z.string(),
      capacity: z.number().nullable()
    })
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
  name: z.string().min(1, 'Event name is required'),
  deal: z.string().optional().default(''),
  date: z.string().min(1, 'Date is required'),
  bandId: z.number('Band is required'),
  venueId: z.number().nullable().optional(),
  loProPersonId: z.number().nullable().optional(),
  loProCompanyId: z.number().nullable().optional(),
  invoiceCompanyId: z.number().nullable().optional(),
  status: z.string().optional(),
  ticketPriceVvk: z.number().nullable().optional(),
  ticketPriceAk: z.number().nullable().optional(),
  notes: z.string().optional().default('')
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
    contractNotes: z.string().optional()
  })

export type UpdateDealMemoInput = z.infer<typeof UpdateDealMemoInput>
