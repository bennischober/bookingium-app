import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { BandAgreementService } from '../../services/BandAgreementService'
import {
  CreateBandAgreementInput,
  UpdateBandAgreementInput
} from '../schemas/band_agreement.schema'

const t = initTRPC.create()
const service = container.resolve(BandAgreementService)

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

/** Publishing and label agreements of a band */
export const bandAgreementRouter = t.router({
  listByBand: t.procedure.input(z.number()).query(async ({ input }) => {
    return await service.listByBand(input)
  }),

  /** New agreement of a kind (copy of the band's latest of that kind, or the defaults) */
  create: t.procedure.input(CreateBandAgreementInput).mutation(async ({ input }) => {
    try {
      return await service.create(input)
    } catch (error) {
      throw badRequest(error, 'Failed to create agreement')
    }
  }),

  update: t.procedure.input(UpdateBandAgreementInput).mutation(async ({ input }) => {
    try {
      return await service.update(input)
    } catch (error) {
      throw badRequest(error, 'Failed to update agreement')
    }
  }),

  delete: t.procedure.input(z.number()).mutation(async ({ input }) => {
    await service.delete(input)
  }),

  getPrintData: t.procedure.input(z.number()).query(async ({ input }) => {
    const data = await service.getPrintData(input)
    if (!data) throw new TRPCError({ code: 'NOT_FOUND' })
    return data
  })
})
