import z from 'zod'

export const TimestampFields = z.object({
  createdAt: z.string(),
  updatedAt: z.string().nullable()
})
export type TimestampFields = z.infer<typeof TimestampFields>

// Pagination input schema
export const PaginationInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(10),
  search: z.string().optional()
})
export type PaginationInput = z.infer<typeof PaginationInput>

// Generic paginated response schema
export const createPaginatedResponse = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number()
  })

export type PaginatedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
