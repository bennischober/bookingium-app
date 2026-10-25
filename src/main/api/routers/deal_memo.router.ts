import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { DealMemoService } from '../../services/DealMemoService'
import { DealMemoMapper } from '../mappers/deal_memo.mapper'
import { CreateDealMemoInput, UpdateDealMemoInput } from '../schemas/deal_memo.schema'
import { PaginationInput } from '../schemas/base.schema'

const t = initTRPC.create()
const dealMemoService = container.resolve(DealMemoService)

export const dealMemoRouter = t.router({
  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await dealMemoService.getAllDealMemosPaginated(input)
    return {
      ...result,
      items: DealMemoMapper.toListItemDtoList(result.items)
    }
  }),

  /** A band's events, newest first (band page) */
  listByBand: t.procedure.input(z.number()).query(async ({ input }) => {
    return DealMemoMapper.toListItemDtoList(await dealMemoService.listDealMemosByBand(input))
  }),

  /** Events at a venue, newest first (venue page) */
  listByVenue: t.procedure.input(z.number()).query(async ({ input }) => {
    return DealMemoMapper.toListItemDtoList(await dealMemoService.listDealMemosByVenue(input))
  }),

  /** Events where a company is LoPro or invoice company, newest first (company page) */
  listByCompany: t.procedure.input(z.number()).query(async ({ input }) => {
    const memos = await dealMemoService.listDealMemosByCompany(input)
    return memos.map((memo) => DealMemoMapper.toDto(memo))
  }),

  /** Events where a person is LoPro contact or the band's TL, newest first (person page) */
  listByPerson: t.procedure.input(z.number()).query(async ({ input }) => {
    const memos = await dealMemoService.listDealMemosByPerson(input)
    return memos.map((memo) => DealMemoMapper.toDto(memo))
  }),

  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const memo = await dealMemoService.getDealMemoById(input)
    if (!memo) throw new TRPCError({ code: 'NOT_FOUND' })
    return DealMemoMapper.toDetailDto(memo)
  }),

  create: t.procedure.input(CreateDealMemoInput).mutation(async ({ input }) => {
    const memo = await dealMemoService.createDealMemo(input)
    return memo
  }),

  update: t.procedure.input(UpdateDealMemoInput).mutation(async ({ input }) => {
    const memo = await dealMemoService.updateDealMemo(input)
    return memo
  }),

  delete: t.procedure.input(z.number()).mutation(async ({ input }) => {
    // D3: a hard delete would cascade away the itinerary and follow-ups, delete the
    // document folder and null the link from any invoice. Refuse while one exists.
    if (await dealMemoService.hasLinkedInvoice(input)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Zu diesem Event existiert eine Rechnung. Archivieren statt löschen.'
      })
    }
    await dealMemoService.deleteDealMemo(input)
  }),

  /** D3: take an event out of every working view without destroying anything */
  archive: t.procedure.input(z.number()).mutation(async ({ input }) => {
    await dealMemoService.archiveDealMemo(input)
  }),

  /** D3: bring an archived event back */
  restore: t.procedure.input(z.number()).mutation(async ({ input }) => {
    await dealMemoService.restoreDealMemo(input)
  }),

  /** D3: the archive view - archived events only */
  listArchived: t.procedure.query(async () => {
    return DealMemoMapper.toListItemDtoList(await dealMemoService.listArchivedDealMemos())
  })
})
