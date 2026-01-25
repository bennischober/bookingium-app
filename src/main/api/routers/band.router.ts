import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { BandService } from '../../services/BandService'
import { BandMapper } from '../mappers/band.mapper'
import { CreateBandInput, UpdateBandInput } from '../schemas/band.schema'
import { PaginationInput } from '../schemas/base.schema'
import z from 'zod'

const t = initTRPC.create()

const bandService = container.resolve(BandService)

export const bandRouter = t.router({
  getAll: t.procedure.query(async () => {
    const bands = await bandService.getAllBands()
    return BandMapper.toDtoList(bands)
  }),

  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await bandService.getAllBandsPaginated(input)
    return {
      ...result,
      items: BandMapper.toDtoList(result.items)
    }
  }),

  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const band = await bandService.getBandById(input)
    if (!band) throw new TRPCError({ code: 'NOT_FOUND' })
    return BandMapper.toDto(band)
  }),

  create: t.procedure.input(CreateBandInput).mutation(async ({ input }) => {
    const band = await bandService.createBand(input)
    return BandMapper.toDto(band)
  }),

  update: t.procedure.input(UpdateBandInput).mutation(async ({ input }) => {
    const band = await bandService.updateBand(input)
    return BandMapper.toDto(band)
  })
})
