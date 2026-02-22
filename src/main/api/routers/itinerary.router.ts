import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { ItineraryService } from '../../services/ItineraryService'
import { ItineraryMapper } from '../mappers/itinerary.mapper'
import { UpsertItineraryInput } from '../schemas/itinerary.schema'

const t = initTRPC.create()
const itineraryService = container.resolve(ItineraryService)

export const itineraryRouter = t.router({
  /** Returns the itinerary for a given deal memo, or null if none exists yet. */
  getByDealMemoId: t.procedure.input(z.number()).query(async ({ input }) => {
    const itinerary = await itineraryService.getByDealMemoId(input)
    return itinerary ? ItineraryMapper.toDto(itinerary) : null
  }),

  /** Creates the itinerary if it doesn't exist yet, otherwise updates it. */
  upsert: t.procedure.input(UpsertItineraryInput).mutation(async ({ input }) => {
    const itinerary = await itineraryService.upsert(input)
    return ItineraryMapper.toDto(itinerary)
  }),

  /** Removes the itinerary for the given deal memo. */
  delete: t.procedure.input(z.number()).mutation(async ({ input }) => {
    await itineraryService.delete(input)
  })
})
