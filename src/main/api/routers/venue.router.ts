import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { VenueService } from '../../services/VenueService'
import { VenueMapper } from '../mappers/venue.mapper'
import { CreateVenueInput, UpdateVenueInput, VenuePaginationInput } from '../schemas/venue.schema'

const t = initTRPC.create()
const venueService = container.resolve(VenueService)

export const venueRouter = t.router({
  getAll: t.procedure.query(async () => {
    const venues = await venueService.getAllVenues()
    return VenueMapper.toDtoList(venues)
  }),

  getListItems: t.procedure.query(async () => {
    const venues = await venueService.getAllVenues()
    return VenueMapper.toListItemList(venues)
  }),

  getAllPaginated: t.procedure.input(VenuePaginationInput).query(async ({ input }) => {
    const result = await venueService.getAllVenuesPaginated(input)
    return {
      ...result,
      items: VenueMapper.toDtoList(result.items)
    }
  }),

  getById: t.procedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const venue = await venueService.getVenueById(input.id)
    return venue ? VenueMapper.toDto(venue) : null
  }),

  create: t.procedure.input(CreateVenueInput).mutation(async ({ input }) => {
    const venue = await venueService.createVenue(input)
    return VenueMapper.toDto(venue)
  }),

  update: t.procedure.input(UpdateVenueInput).mutation(async ({ input }) => {
    const venue = await venueService.updateVenue(input)
    return VenueMapper.toDto(venue)
  }),

  delete: t.procedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await venueService.deleteVenue(input.id)
  })
})
