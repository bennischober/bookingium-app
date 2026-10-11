import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { ContractService } from '../../services/ContractService'

const t = initTRPC.create()
const contractService = container.resolve(ContractService)

export const contractRouter = t.router({
  getData: t.procedure.input(z.number()).query(async ({ input }) => {
    const data = await contractService.getContractData(input)
    if (!data) throw new TRPCError({ code: 'NOT_FOUND' })
    return data
  })
})
