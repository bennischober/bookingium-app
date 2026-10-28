import { z } from 'zod'
import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { and, eq, isNotNull, lt, or, desc } from 'drizzle-orm'
import { db } from '../../db'
import { schema, MAIL_LINK_ENTITY_TYPES } from '../../db/schema'
import { MailLinkService, MANUAL_LINK_ENTITY_TYPES } from '../../services/MailLinkService'
import { mailClient } from '../../mailclient/MailClientService'
import { listMailAccounts } from '../../mailclient/accounts'

const t = initTRPC.create()
const service = container.resolve(MailLinkService)

/** C3: one row of the E-Mails tab. No mail content, only what the panel shows. */
export type MailLinkRow = {
  id: number
  /** the account the mail lives in, for opening its window */
  accountId: string
  messageId: string | null
  /** the mail store's row id, for opening the mail window; null when gone */
  storeId: number | null
  source: string
  /** null when the mail is no longer in the store; the link stays */
  subject: string | null
  fromName: string | null
  fromEmail: string | null
  date: string | null
  hasAttachments: boolean
}

const ListByEntityInput = z.object({
  entityType: z.enum(MAIL_LINK_ENTITY_TYPES),
  entityId: z.number().int().positive(),
  /** the last row's id, for the next page */
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(20)
})

export const mailLinkRouter = t.router({
  /**
   * C3: the mails linked to one record, newest first.
   *
   * A band also shows the mails of its events - its own links come first, then
   * its events' links, which is why this joins through deal_memo.
   */
  listByEntity: t.procedure.input(ListByEntityInput).query(async ({ input }) => {
    // The records whose links this entity shows: itself, plus an event's band
    const entityIds: { type: typeof input.entityType; id: number }[] = [
      { type: input.entityType, id: input.entityId }
    ]
    if (input.entityType === 'band') {
      const events = db
        .select({ id: schema.deal_memo.id })
        .from(schema.deal_memo)
        .where(eq(schema.deal_memo.band_id, input.entityId))
        .all()
      for (const event of events) entityIds.push({ type: 'event', id: event.id })
    }

    const conditions = entityIds.map((e) =>
      and(eq(schema.mail_link.entity_type, e.type), eq(schema.mail_link.entity_id, e.id))
    )
    const rows = db
      .select()
      .from(schema.mail_link)
      .where(
        and(
          eq(schema.mail_link.dismissed, false),
          // A mail without a Message-ID has no store row to show
          isNotNull(schema.mail_link.message_id),
          input.cursor ? lt(schema.mail_link.id, input.cursor) : undefined,
          or(...conditions)
        )
      )
      .orderBy(desc(schema.mail_link.id))
      .limit(input.limit + 1)
      .all()

    const page = rows.slice(0, input.limit)
    const nextCursor = rows.length > input.limit ? (page[page.length - 1]?.id ?? null) : null

    // The rows themselves come from the mail store, by Message-ID. A link names its
    // own account, so a record's mails are looked up per account.
    const byAccount = new Map<string, string[]>()
    for (const link of page) {
      const id = link.message_id
      if (!id) continue
      const list = byAccount.get(link.mail_account_id) ?? []
      list.push(id)
      byAccount.set(link.mail_account_id, list)
    }
    type MailRow = {
      id: number
      messageId?: string | null
      subject: string
      fromName: string
      fromEmail: string
      date: string | null
      hasAttachments: boolean
    }
    const items: MailRow[] = []
    for (const [account, ids] of byAccount) {
      const found = (await mailClient
        .call('findByMessageIds', [ids, account])
        .catch(() => [])) as MailRow[]
      items.push(...found)
    }
    const byId = new Map(items.map((m) => [normalizeId(m.messageId), m]))

    return {
      rows: page.map((link): MailLinkRow => {
        const mail = byId.get(normalizeId(link.message_id))
        return {
          id: link.id,
          accountId: link.mail_account_id,
          messageId: link.message_id,
          storeId: mail?.id ?? null,
          source: link.source,
          // A link stays when its mail is gone from the store
          subject: mail?.subject ?? null,
          fromName: mail?.fromName ?? null,
          fromEmail: mail?.fromEmail ?? null,
          date: mail?.date ?? null,
          hasAttachments: mail?.hasAttachments ?? false
        }
      }),
      nextCursor
    }
  }),

  /** "Zuordnung entfernen": the link stays, dismissed, so it is never re-added */
  dismiss: t.procedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => {
      service.dismissLink(input.id)
      return { ok: true }
    }),

  /**
   * "Zuordnen…": links one mail to a record the user picked. A link they removed
   * before comes back. `linked` is false when the mail was linked to it already.
   */
  link: t.procedure
    .input(
      z.object({
        accountId: z.string().min(1),
        messageId: z.string().min(1),
        entityType: z.enum(MANUAL_LINK_ENTITY_TYPES),
        entityId: z.number().int().positive()
      })
    )
    .mutation(({ input }) => {
      // The id comes from the renderer: no link to an account that is not configured
      if (!listMailAccounts().some((account) => account.id === input.accountId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Das Mail-Konto gibt es nicht mehr' })
      }
      try {
        return { linked: service.linkManually(input) > 0 }
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }),

  /**
   * C5: the records one mail is linked to, for pre-selecting where its attachment
   * should be saved. Only undismissed links with a nameable owner come back.
   */
  linksForMessage: t.procedure
    .input(z.object({ accountId: z.string().min(1), messageId: z.string().min(1) }))
    .query(({ input }) => {
      const id = normalizeId(input.messageId)
      if (!id) return []
      return db
        .select({
          entityType: schema.mail_link.entity_type,
          entityId: schema.mail_link.entity_id
        })
        .from(schema.mail_link)
        .where(
          and(
            eq(schema.mail_link.mail_account_id, input.accountId),
            eq(schema.mail_link.message_id, id),
            eq(schema.mail_link.dismissed, false)
          )
        )
        .all()
    })
})

const normalizeId = (id: string | null | undefined): string =>
  (id ?? '').replace(/^</, '').replace(/>$/, '').trim()
