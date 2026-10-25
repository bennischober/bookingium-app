import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { container } from 'tsyringe'
import { SearchService } from '../../services/SearchService'

const t = initTRPC.create()
const searchService = container.resolve(SearchService)

export const SearchResultItem = z.object({
  // Business object type: 'event' | 'band' | 'company' | 'person' | 'venue' | 'hotel' | 'invoice' | 'document'
  type: z.string(),
  id: z.number(),
  // Primary display label
  label: z.string(),
  // Optional secondary line (city, genre, status...)
  sublabel: z.string().nullable(),
  // Navigation route (TanStack Router path with $params) + params; empty for a document
  route: z.string(),
  routeParams: z.record(z.string(), z.string()).nullable(),
  // D2: only a document carries one - it is opened directly instead of navigating
  filePath: z.string().nullable()
})

export type SearchResultItem = z.infer<typeof SearchResultItem>

export const SearchResponse = z.object({
  results: z.array(SearchResultItem),
  truncated: z.boolean()
})

export const searchRouter = t.router({
  search: t.procedure
    .input(
      z.object({
        query: z.string().min(1),
        // Per-type limit; total is capped by the service as well
        limit: z.number().max(10).optional().default(4)
      })
    )
    .query(async ({ input }) => searchService.search(input.query, input.limit))
})
