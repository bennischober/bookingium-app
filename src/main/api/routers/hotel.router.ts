import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { db } from '../../db'
import { schema } from '../../db/schema'
import { eq } from 'drizzle-orm'

const t = initTRPC.create()

export const hotelRouter = t.router({
  /** Lightweight list for combobox pickers. */
  getListItems: t.procedure.query(async () => {
    const rows = await db
      .select({ id: schema.hotel.id, name: schema.hotel.name })
      .from(schema.hotel)
      .orderBy(schema.hotel.name)
    return rows
  }),

  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const rows = await db
      .select()
      .from(schema.hotel)
      .where(eq(schema.hotel.id, input))
      .limit(1)
    return rows[0] ?? null
  })
})
