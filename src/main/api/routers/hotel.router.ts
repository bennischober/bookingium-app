import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { db } from '../../db'
import { schema } from '../../db/schema'
import { eq, like, sql } from 'drizzle-orm'
import { PaginationInput } from '../schemas/base.schema'
import { CreateHotelInput, UpdateHotelInput } from '../schemas/hotel.schema'

const t = initTRPC.create()

export const hotelRouter = t.router({
  getAll: t.procedure.query(async () => {
    return await db
      .select({
        id: schema.hotel.id,
        name: schema.hotel.name,
        notes: sql<string>`coalesce(${schema.hotel.notes}, '')`,
        addressId: schema.hotel.address_id,
        contactId: schema.hotel.contact_id,
        createdAt: schema.hotel.created_at,
        updatedAt: schema.hotel.updated_at
      })
      .from(schema.hotel)
      .orderBy(schema.hotel.name)
  }),

  /** Lightweight list for combobox pickers. */
  getListItems: t.procedure.query(async () => {
    const rows = await db
      .select({ id: schema.hotel.id, name: schema.hotel.name })
      .from(schema.hotel)
      .orderBy(schema.hotel.name)
    return rows
  }),

  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const { page, pageSize, search } = input
    const offset = (page - 1) * pageSize
    const whereClause = search ? like(schema.hotel.name, `%${search}%`) : undefined

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.hotel)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    const items = await db
      .select({
        id: schema.hotel.id,
        name: schema.hotel.name,
        notes: sql<string>`coalesce(${schema.hotel.notes}, '')`,
        addressId: schema.hotel.address_id,
        contactId: schema.hotel.contact_id,
        createdAt: schema.hotel.created_at,
        updatedAt: schema.hotel.updated_at
      })
      .from(schema.hotel)
      .where(whereClause)
      .limit(pageSize)
      .offset(offset)
      .orderBy(schema.hotel.name)

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }),

  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const rows = await db
      .select({
        id: schema.hotel.id,
        name: schema.hotel.name,
        notes: sql<string>`coalesce(${schema.hotel.notes}, '')`,
        addressId: schema.hotel.address_id,
        contactId: schema.hotel.contact_id,
        createdAt: schema.hotel.created_at,
        updatedAt: schema.hotel.updated_at
      })
      .from(schema.hotel)
      .where(eq(schema.hotel.id, input))
      .limit(1)
    return rows[0] ?? null
  }),

  create: t.procedure.input(CreateHotelInput).mutation(async ({ input }) => {
    const rows = await db
      .insert(schema.hotel)
      .values({
        name: input.name,
        notes: input.notes,
        address_id: input.addressId ?? null,
        contact_id: input.contactId ?? null
      })
      .returning({
        id: schema.hotel.id,
        name: schema.hotel.name,
        notes: sql<string>`coalesce(${schema.hotel.notes}, '')`,
        addressId: schema.hotel.address_id,
        contactId: schema.hotel.contact_id,
        createdAt: schema.hotel.created_at,
        updatedAt: schema.hotel.updated_at
      })

    return rows[0]
  }),

  update: t.procedure.input(UpdateHotelInput).mutation(async ({ input }) => {
    const rows = await db
      .update(schema.hotel)
      .set({
        name: input.name,
        notes: input.notes,
        address_id: input.addressId ?? null,
        contact_id: input.contactId ?? null,
        updated_at: sql`datetime('now')`
      })
      .where(eq(schema.hotel.id, input.id))
      .returning({
        id: schema.hotel.id,
        name: schema.hotel.name,
        notes: sql<string>`coalesce(${schema.hotel.notes}, '')`,
        addressId: schema.hotel.address_id,
        contactId: schema.hotel.contact_id,
        createdAt: schema.hotel.created_at,
        updatedAt: schema.hotel.updated_at
      })

    return rows[0]
  }),

  delete: t.procedure.input(z.number()).mutation(async ({ input }) => {
    const rows = await db
      .delete(schema.hotel)
      .where(eq(schema.hotel.id, input))
      .returning({
        id: schema.hotel.id,
        name: schema.hotel.name,
        notes: sql<string>`coalesce(${schema.hotel.notes}, '')`,
        addressId: schema.hotel.address_id,
        contactId: schema.hotel.contact_id,
        createdAt: schema.hotel.created_at,
        updatedAt: schema.hotel.updated_at
      })

    return rows[0]
  })
})
