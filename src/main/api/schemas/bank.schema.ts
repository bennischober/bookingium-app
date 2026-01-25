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
  bankName: z.string().min(1, 'Bank name is required'),
  accountHolder: z.string().min(1, 'Account holder is required'),
  iban: z.string().min(15, 'IBAN must be at least 15 characters').max(34, 'IBAN cannot exceed 34 characters'),
  bic: z.string().min(8, 'BIC must be at least 8 characters').max(11, 'BIC cannot exceed 11 characters')
})

export type CreateBankInput = z.infer<typeof CreateBankInput>

/**
 * Update bank input schema
 */
export const UpdateBankInput = z.object({
  id: z.number(),
  bankName: z.string().min(1, 'Bank name is required'),
  accountHolder: z.string().min(1, 'Account holder is required'),
  iban: z.string().min(15, 'IBAN must be at least 15 characters').max(34, 'IBAN cannot exceed 34 characters'),
  bic: z.string().min(8, 'BIC must be at least 8 characters').max(11, 'BIC cannot exceed 11 characters')
})

export type UpdateBankInput = z.infer<typeof UpdateBankInput>

/**
 * Paginated bank response
 */
export const PaginatedBankResponse = createPaginatedResponse(BankDto)
export type PaginatedBankResponse = z.infer<typeof PaginatedBankResponse>
