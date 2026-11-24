import { z } from 'zod'
import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { ReleaseService } from '../../services/ReleaseService'
import { ReleaseMapper } from '../mappers/release.mapper'
import { PaginationInput } from '../schemas/base.schema'
import {
  CreateReleaseInput,
  MoveTrackInput,
  SaveProductInput,
  SaveReleaseCreditsInput,
  SaveTrackInput,
  UpdateReleaseInput
} from '../schemas/release.schema'

const t = initTRPC.create()
const releaseService = container.resolve(ReleaseService)

const Id = z.number().int().positive()

/** Releases (#289). Every change answers with the whole release, so the page shows it at once. */
export const releaseRouter = t.router({
  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await releaseService.getAllPaginated(input)
    return { ...result, items: ReleaseMapper.toDtoList(result.items) }
  }),

  listByBand: t.procedure.input(Id).query(async ({ input }) => {
    return ReleaseMapper.toDtoList(await releaseService.listByBand(input))
  }),

  getById: t.procedure.input(Id).query(async ({ input }) => {
    const release = await releaseService.getDetail(input)
    if (!release) throw new TRPCError({ code: 'NOT_FOUND', message: 'Release nicht gefunden' })
    return ReleaseMapper.toDetailDto(release)
  }),

  create: t.procedure.input(CreateReleaseInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.create(input))
  }),

  update: t.procedure.input(UpdateReleaseInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.update(input))
  }),

  delete: t.procedure.input(Id).mutation(async ({ input }) => {
    await releaseService.delete(input)
  }),

  saveCredits: t.procedure.input(SaveReleaseCreditsInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.saveCredits(input))
  }),

  saveTrack: t.procedure.input(SaveTrackInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.saveTrack(input))
  }),

  deleteTrack: t.procedure.input(Id).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.deleteTrack(input))
  }),

  moveTrack: t.procedure.input(MoveTrackInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.moveTrack(input))
  }),

  saveProduct: t.procedure.input(SaveProductInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.saveProduct(input))
  }),

  deleteProduct: t.procedure.input(Id).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.deleteProduct(input))
  })
})
