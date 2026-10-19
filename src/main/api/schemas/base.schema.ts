import z from 'zod'

export const TimestampFields = z.object({
  createdAt: z.string(),
  updatedAt: z.string().nullable()
})
export type TimestampFields = z.infer<typeof TimestampFields>

export const SortDirection = z.enum(['asc', 'desc'])
export type SortDirection = z.infer<typeof SortDirection>

// List input: a page of a list, optionally searched and sorted
export const PaginationInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  // A column key of the list (the grid's column id); each repository maps
  // its keys to SQL columns, unknown keys fall back to the default order
  sortBy: z.string().optional(),
  sortDir: SortDirection.optional(),
  // Infinite queries (lists that load more while scrolling) pass the next
  // page here; it wins over `page`
  cursor: z.number().int().min(1).nullish()
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
