import { z } from 'zod'
import { initTRPC, TRPCError } from '@trpc/server'
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

  /** Venues run by a company (company page) */
  listByCompany: t.procedure.input(z.number()).query(async ({ input }) => {
    return VenueMapper.toDtoList(await venueService.listVenuesByCompany(input))
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

  /** Companies that probably run the venue, while none is linked (venue page) */
  companySuggestions: t.procedure
    .input(z.object({ venueId: z.number() }))
    .query(({ input }) => venueService.companySuggestions(input.venueId)),

  /** Sets only the venue's company, from the suggestion on the venue page */
  linkCompany: t.procedure
    .input(z.object({ venueId: z.number(), companyId: z.number().nullable() }))
    .mutation(({ input }) => {
      try {
        venueService.linkCompany(input.venueId, input.companyId)
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Firma konnte nicht verknüpft werden'
        })
      }
    }),

  delete: t.procedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await venueService.deleteVenue(input.id)
  })
})
