import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { BankService } from '../../services/BankService'
import { BankMapper } from '../mappers/bank.mapper'
import { CreateBankInput, UpdateBankInput } from '../schemas/bank.schema'
import { PaginationInput } from '../schemas/base.schema'

const t = initTRPC.create()
const bankService = container.resolve(BankService)

export const bankRouter = t.router({
  getAll: t.procedure.query(async () => {
    const banks = await bankService.getAllBanks()
    return BankMapper.toDtoList(banks)
  }),

  getListItems: t.procedure.query(async () => {
    const banks = await bankService.getAllBanks()
    return BankMapper.toListItemList(banks)
  }),

  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await bankService.getAllBanksPaginated(input)
    return {
      ...result,
      items: BankMapper.toDtoList(result.items)
    }
  }),

  getById: t.procedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const bank = await bankService.getBankById(input.id)
    return bank ? BankMapper.toDto(bank) : null
  }),

  create: t.procedure.input(CreateBankInput).mutation(async ({ input }) => {
    const bank = await bankService.createBank(input)
    return BankMapper.toDto(bank)
  }),

  update: t.procedure.input(UpdateBankInput).mutation(async ({ input }) => {
    const bank = await bankService.updateBank(input)
    return BankMapper.toDto(bank)
  }),

  delete: t.procedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await bankService.deleteBank(input.id)
  })
})
