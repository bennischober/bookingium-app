import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { ManagementContractService } from '../../services/ManagementContractService'
import { ManagementContractMapper } from '../mappers/management_contract.mapper'
import {
  CreateManagementShareInput,
  UpdateManagementContractInput
} from '../schemas/management_contract.schema'

const t = initTRPC.create()
const service = container.resolve(ManagementContractService)

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

export const managementContractRouter = t.router({
  listByBand: t.procedure.input(z.number()).query(async ({ input }) => {
    return ManagementContractMapper.toDtoList(await service.listByBand(input))
  }),

  /** New contract for a band (copy of its latest, or the draft defaults) */
  createForBand: t.procedure.input(z.number()).mutation(async ({ input }) => {
    try {
      return ManagementContractMapper.toDto(await service.createForBand(input))
    } catch (error) {
      throw badRequest(error, 'Failed to create management contract')
    }
  }),

  update: t.procedure.input(UpdateManagementContractInput).mutation(async ({ input }) => {
    try {
      return ManagementContractMapper.toDto(await service.update(input))
    } catch (error) {
      throw badRequest(error, 'Failed to update management contract')
    }
  }),

  delete: t.procedure.input(z.number()).mutation(async ({ input }) => {
    await service.delete(input)
  }),

  getPrintData: t.procedure.input(z.number()).query(async ({ input }) => {
    const data = await service.getPrintData(input)
    if (!data) throw new TRPCError({ code: 'NOT_FOUND' })
    return data
  }),

  /** Quarterly management share: draft invoice from the contract's terms */
  createShare: t.procedure.input(CreateManagementShareInput).mutation(async ({ input }) => {
    try {
      return await service.createShare(input)
    } catch (error) {
      throw badRequest(error, 'Failed to create management share invoice')
    }
  }),

  listSharesByBand: t.procedure.input(z.number()).query(async ({ input }) => {
    return await service.listSharesByBand(input)
  })
})
