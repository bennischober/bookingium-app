import { z } from 'zod'
import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { and, eq, inArray, isNotNull, lt, or, desc, sql } from 'drizzle-orm'
import { db } from '../../db'
import { schema, MAIL_LINK_ENTITY_TYPES } from '../../db/schema'
import { MailLinkService, MANUAL_LINK_ENTITY_TYPES } from '../../services/MailLinkService'
import { mailClient } from '../../mailclient/MailClientService'
import { listMailAccounts } from '../../mailclient/accounts'

const t = initTRPC.create()
const service = container.resolve(MailLinkService)

/**
 * The mail's own date, for storing it on a new link. The store answers by
 * Message-ID; a store that is down or does not know the mail leaves the date
 * null instead of failing the link - the tab then sorts that row last rather
 * than by a wrong date.
 */
async function mailDateFor(accountId: string, messageId: string): Promise<string | null> {
  const id = messageId.replace(/^</, '').replace(/>$/, '').trim()
  if (!id) return null
  try {
    const found = (await mailClient.call('findByMessageIds', [[id], accountId])) as {
      date?: string | null
    }[]
    return found[0]?.date ?? null
  } catch {
    return null
  }
}

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
  /** the mail's read state, so the row matches the /mail list; null when gone */
  unread: boolean | null
  /**
   * The event a band's tab shows this mail through, so the row says where it
   * came from; null for the record's own links
   */
  sourceEvent: { id: number; name: string } | null
}

const ListByEntityInput = z.object({
  entityType: z.enum(MAIL_LINK_ENTITY_TYPES),
  entityId: z.number().int().positive(),
  /**
   * The last row of the previous page, for the next one. Sorting by the mail's
   * own date means the row id alone is not a position, so the cursor carries the
   * date as well - a link made today to a March mail sorts by March.
   */
  cursor: z.object({ mailDate: z.string().nullable(), id: z.number().int().positive() }).optional(),
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
    // Links from before mail_date existed (and mails the store did not know) have no
    // date. As '' they sort last and stay comparable, so the cursor reaches them too:
    // a plain NULL would fail every comparison and end the list at the first one.
    const mailDate = sql<string>`coalesce(${schema.mail_link.mail_date}, '')`
    const rows = db
      .select()
      .from(schema.mail_link)
      .where(
        and(
          eq(schema.mail_link.dismissed, false),
          // A mail without a Message-ID has no store row to show
          isNotNull(schema.mail_link.message_id),
          // The next page starts below the last row of this one. Rows without a
          // date sort last, so they are only reached once no dated row is left.
          input.cursor
            ? or(
                lt(mailDate, input.cursor.mailDate ?? ''),
                and(
                  eq(mailDate, input.cursor.mailDate ?? ''),
                  lt(schema.mail_link.id, input.cursor.id)
                )
              )
            : undefined,
          or(...conditions)
        )
      )
      // Newest mail first: a mail linked by hand today from a March thread
      // sorts where the mail belongs, not where the link was made
      .orderBy(desc(mailDate), desc(schema.mail_link.id))
      .limit(input.limit + 1)
      .all()

    const page = rows.slice(0, input.limit)
    const last = page[page.length - 1]
    const nextCursor =
      rows.length > input.limit && last ? { mailDate: last.mail_date ?? null, id: last.id } : null

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
      unread?: boolean
    }
    const items: MailRow[] = []
    // A failed lookup (worker down, store locked) is not "the mail is gone": the panel says
    // the mailbox is unreachable instead of marking every row as no longer in it
    let unavailable = false
    for (const [account, ids] of byAccount) {
      try {
        items.push(...((await mailClient.call('findByMessageIds', [ids, account])) as MailRow[]))
      } catch {
        unavailable = true
      }
    }
    const byId = new Map(items.map((m) => [normalizeId(m.messageId), m]))

    // A link without a date gets it from the store once the mail is found, so older
    // links move to where their mail belongs instead of staying at the end for good
    for (const link of page) {
      const date = link.mail_date === null ? byId.get(normalizeId(link.message_id))?.date : null
      if (!date) continue
      db.update(schema.mail_link)
        .set({ mail_date: date })
        .where(eq(schema.mail_link.id, link.id))
        .run()
    }

    // The event names a band's tab shows its mails through, in one query for
    // the page (the band's own links have no event)
    const eventIds = [
      ...new Set(page.filter((link) => link.entity_type === 'event').map((link) => link.entity_id))
    ]
    const events = new Map<number, string>()
    if (eventIds.length > 0) {
      const rows = db
        .select({ id: schema.deal_memo.id, name: schema.deal_memo.name })
        .from(schema.deal_memo)
        .where(inArray(schema.deal_memo.id, eventIds))
        .all()
      for (const row of rows) events.set(row.id, row.name)
    }

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
          hasAttachments: mail?.hasAttachments ?? false,
          unread: mail?.unread ?? null,
          // Only a band's tab mixes in an event's links, so only there does a
          // row need to say which event it came from
          sourceEvent:
            link.entity_type === 'event' &&
            link.entity_id !== input.entityId &&
            events.has(link.entity_id)
              ? { id: link.entity_id, name: events.get(link.entity_id) ?? '' }
              : null
        }
      }),
      nextCursor,
      unavailable
    }
  }),

  /** "Zuordnung entfernen": the link stays, dismissed, so it is never re-added */
  dismiss: t.procedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => {
      service.dismissLink(input.id)
      return { ok: true }
    }),

  /** "Rückgängig" after "Zuordnung entfernen": the link shows again, as it was */
  restore: t.procedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => {
      service.restoreLink(input.id)
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
    .mutation(async ({ input }) => {
      // The id comes from the renderer: no link to an account that is not configured
      if (!listMailAccounts().some((account) => account.id === input.accountId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Das Mail-Konto gibt es nicht mehr' })
      }
      try {
        // The mail's own date, so the tab sorts by it and not by when the user
        // linked it. A store that does not answer leaves it null (the row then
        // sorts last rather than by a wrong date).
        const mailDate = await mailDateFor(input.accountId, input.messageId)
        return { linked: service.linkManually({ ...input, mailDate }) > 0 }
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
