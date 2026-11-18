import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import { container } from 'tsyringe'
import { TripService } from '../../services/TripService'
import { TripFields, UpdateTripInput } from '../schemas/trip.schema'

const t = initTRPC.create()
const service = container.resolve(TripService)

const badRequest = (error: unknown, fallback: string): TRPCError =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error && error.message ? error.message : fallback
  })

const IdInput = z.object({ id: z.number().int().positive() })

/** #225 step 2: business trips (Reisekostenabrechnung); the report goes to DATEV as a receipt */
export const tripRouter = t.router({
  list: t.procedure.query(() => service.list()),

  getById: t.procedure.input(IdInput).query(({ input }) => {
    const trip = service.get(input.id)
    if (!trip) throw new TRPCError({ code: 'NOT_FOUND', message: 'Reise nicht gefunden' })
    return trip
  }),

  create: t.procedure.input(TripFields).mutation(({ input }) => {
    try {
      return service.create(input)
    } catch (error) {
      throw badRequest(error, 'Reise konnte nicht gespeichert werden')
    }
  }),

  update: t.procedure.input(UpdateTripInput).mutation(({ input }) => {
    try {
      return service.update(input)
    } catch (error) {
      throw badRequest(error, 'Reise konnte nicht gespeichert werden')
    }
  }),

  delete: t.procedure.input(IdInput).mutation(({ input }) => service.delete(input.id)),

  /** Receipts of no trip, for "Beleg zuordnen" */
  unassignedReceipts: t.procedure.query(() => service.unassignedReceipts()),

  assignReceipt: t.procedure
    .input(
      z.object({
        receiptId: z.number().int().positive(),
        tripId: z.number().int().positive().nullable()
      })
    )
    .mutation(({ input }) => {
      try {
        service.assignReceipt(input.receiptId, input.tripId)
      } catch (error) {
        throw badRequest(error, 'Beleg konnte nicht zugeordnet werden')
      }
    }),

  /** Builds (or rebuilds) the report PDF; returns the receipt it is stored as */
  buildReport: t.procedure.input(IdInput).mutation(async ({ input }) => {
    try {
      return { receiptId: await service.buildReport(input.id) }
    } catch (error) {
      throw badRequest(error, 'Abrechnung konnte nicht erstellt werden')
    }
  })
})
