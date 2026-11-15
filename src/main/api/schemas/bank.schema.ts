import { z } from 'zod'
import { createPaginatedResponse } from './base.schema'

/**
 * Bank DTO for frontend consumption
 */
export const BankDto = z.object({
  id: z.number(),
  bankName: z.string(),
  accountHolder: z.string(),
  iban: z.string(),
  bic: z.string()
})

export type BankDto = z.infer<typeof BankDto>

/**
 * Bank list item DTO (lightweight for dropdowns)
 */
export const BankListItemDto = z.object({
  id: z.number(),
  bankName: z.string(),
  accountHolder: z.string()
})

export type BankListItemDto = z.infer<typeof BankListItemDto>

/**
 * Create bank input schema
 */
export const CreateBankInput = z.object({
  bankName: z.string().min(1, 'Name der Bank ist erforderlich'),
  accountHolder: z.string().min(1, 'Kontoinhaber ist erforderlich'),
  iban: z
    .string()
    .min(15, 'Die IBAN hat mindestens 15 Zeichen')
    .max(34, 'Die IBAN hat höchstens 34 Zeichen'),
  bic: z
    .string()
    .min(8, 'Die BIC hat mindestens 8 Zeichen')
    .max(11, 'Die BIC hat höchstens 11 Zeichen')
})

export type CreateBankInput = z.infer<typeof CreateBankInput>

/**
 * Update bank input schema
 */
export const UpdateBankInput = z.object({
  id: z.number(),
  bankName: z.string().min(1, 'Name der Bank ist erforderlich'),
  accountHolder: z.string().min(1, 'Kontoinhaber ist erforderlich'),
  iban: z
    .string()
    .min(15, 'Die IBAN hat mindestens 15 Zeichen')
    .max(34, 'Die IBAN hat höchstens 34 Zeichen'),
  bic: z
    .string()
    .min(8, 'Die BIC hat mindestens 8 Zeichen')
    .max(11, 'Die BIC hat höchstens 11 Zeichen')
})

export type UpdateBankInput = z.infer<typeof UpdateBankInput>

/**
 * Paginated bank response
 */
export const PaginatedBankResponse = createPaginatedResponse(BankDto)
export type PaginatedBankResponse = z.infer<typeof PaginatedBankResponse>
