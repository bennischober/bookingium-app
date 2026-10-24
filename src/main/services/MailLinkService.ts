import { injectable, inject } from 'tsyringe'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema, type MailLinkEntityType, type MailLinkSource } from '../db/schema'
import { mailClient } from '../mailclient/MailClientService'
import type { MessageHeader } from '../mailclient/core/types'
import { SettingsRepository } from '../repositories/SettingsRepository'

/**
 * C2: which mails belong to which record.
 *
 * The mail store is rebuildable, so a link names the mail by its Message-ID (or a
 * fallback hash) and its account - never the store's row id or message_key. Links
 * survive a move, a re-sync and a rebuild of the store.
 */

/** Addresses that match more than this are shared mailboxes; never auto-link them */
export const SHARED_ADDRESS_LIMIT = 20
/** Mails per linking round; the linker yields between batches */
export const LINK_BATCH = 500

/** The parts of a mail the linker needs; no subject, no body */
export type LinkableHeader = {
  messageId: string | null
  fallbackKey: string
  inReplyTo: string | null
  references: string[]
  fromEmail: string
  toEmails: string[]
  ccEmails: string[]
}

export type ResolvedOwner = { entityType: MailLinkEntityType; entityId: number }
export type ResolvedLink = { owner: ResolvedOwner; source: MailLinkSource }

/** The address lookups the linker needs, so resolution is testable without a DB */
export type AddressLookup = (address: string) => ResolvedOwner[]
/** The links already stored for a Message-ID, for thread inheritance */
export type ThreadLookup = (messageId: string) => ResolvedOwner[]

/** Every address of a mail, lower-cased and trimmed, without the account's own */
export function mailAddresses(
  header: Pick<LinkableHeader, 'fromEmail' | 'toEmails' | 'ccEmails'>,
  ownEmail: string
): string[] {
  const own = ownEmail.trim().toLowerCase()
  return [header.fromEmail, ...header.toEmails, ...header.ccEmails]
    .map((a) => (a ?? '').trim().toLowerCase())
    .filter((a) => a.length > 0 && a !== own)
}

/** The Message-IDs a mail answers or quotes, without the angle brackets */
export function threadParents(header: Pick<LinkableHeader, 'inReplyTo' | 'references'>): string[] {
  const strip = (id: string): string => id.replace(/^</, '').replace(/>$/, '').trim()
  return [header.inReplyTo, ...header.references].map((id) => (id ? strip(id) : '')).filter(Boolean)
}

/**
 * C2: the links one mail produces.
 *
 * Address links come first; thread links are inherited only when the parent mail
 * already has links. A band is never linked through its members' addresses - members
 * also write about other things.
 */
export function resolveLinks(
  header: LinkableHeader,
  ownEmail: string,
  lookupAddress: AddressLookup,
  lookupThread: ThreadLookup
): ResolvedLink[] {
  const out: ResolvedLink[] = []
  const seen = new Set<string>()
  const add = (owner: ResolvedOwner, source: MailLinkSource): void => {
    const key = `${owner.entityType}:${owner.entityId}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ owner, source })
  }

  for (const address of mailAddresses(header, ownEmail)) {
    for (const owner of lookupAddress(address)) add(owner, 'address')
  }
  for (const parent of threadParents(header)) {
    for (const owner of lookupThread(parent)) add(owner, 'thread')
  }
  return out
}

@injectable()
export class MailLinkService {
  constructor(@inject(SettingsRepository) private settings: SettingsRepository) {}

  private cursorKey(accountId: string): string {
    return `mailLinkCursor:${accountId}`
  }

  /** Stored cursor per account; a missing or broken value starts at 0 */
  cursorFor(accountId: string): number {
    const raw = this.settings.getAll()[this.cursorKey(accountId)]
    if (raw === undefined) return 0
    try {
      const parsed = Number(JSON.parse(raw))
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    } catch {
      return 0
    }
  }

  private saveCursor(accountId: string, cursor: number): void {
    this.settings.setMany({ [this.cursorKey(accountId)]: JSON.stringify(cursor) })
  }

  /** The records that own an address, capped so a shared mailbox links nothing */
  addressOwners(address: string): ResolvedOwner[] {
    const email = address.trim().toLowerCase()
    if (!email) return []
    const contacts = db
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(sql`lower(trim(${schema.contact.email})) = ${email}`)
      .all()
    if (contacts.length === 0 || contacts.length > SHARED_ADDRESS_LIMIT) return []
    const ids = contacts.map((c) => c.id)
    const out: ResolvedOwner[] = []
    const push = (entityType: MailLinkEntityType, rows: { id: number }[]): void => {
      for (const row of rows) out.push({ entityType, entityId: row.id })
    }
    push(
      'person',
      db
        .select({ id: schema.person.id })
        .from(schema.person)
        .where(inArray(schema.person.contact_id, ids))
        .all()
    )
    push(
      'company',
      db
        .select({ id: schema.company.id })
        .from(schema.company)
        .where(inArray(schema.company.contact_id, ids))
        .all()
    )
    push(
      'venue',
      db
        .select({ id: schema.venue.id })
        .from(schema.venue)
        .where(inArray(schema.venue.contact_id, ids))
        .all()
    )
    return out
  }

  /** Links already stored for a Message-ID (the parent of a thread) */
  threadOwners(messageId: string, accountId: string): ResolvedOwner[] {
    const id = messageId.replace(/^</, '').replace(/>$/, '').trim()
    if (!id) return []
    const rows = db
      .select({
        entity_type: schema.mail_link.entity_type,
        entity_id: schema.mail_link.entity_id
      })
      .from(schema.mail_link)
      .where(
        and(eq(schema.mail_link.mail_account_id, accountId), eq(schema.mail_link.message_id, id))
      )
      .all()
    return rows.map((r) => ({ entityType: r.entity_type, entityId: r.entity_id }))
  }

  /** One linking round over a batch of headers; returns how many links were added */
  linkBatch(accountId: string, ownEmail: string, headers: LinkableHeader[]): number {
    let added = 0
    for (const header of headers) {
      const links = resolveLinks(
        header,
        ownEmail,
        (address) => this.addressOwners(address),
        (messageId) => this.threadOwners(messageId, accountId)
      )
      for (const link of links) {
        added += this.insertLink({
          accountId,
          messageId: header.messageId,
          fallbackKey: header.fallbackKey,
          entityType: link.owner.entityType,
          entityId: link.owner.entityId,
          source: link.source
        })
      }
    }
    return added
  }

  /**
   * Inserts one link unless it exists or the user dismissed that exact link.
   * Returns 1 when a row was added, 0 otherwise.
   */
  insertLink(input: {
    accountId: string
    messageId: string | null
    fallbackKey: string | null
    entityType: MailLinkEntityType
    entityId: number
    source: MailLinkSource
  }): number {
    const messageId = input.messageId?.replace(/^</, '').replace(/>$/, '').trim() || null
    const fallbackKey = messageId ? null : input.fallbackKey
    const sameMessage = messageId
      ? eq(schema.mail_link.message_id, messageId)
      : eq(schema.mail_link.fallback_key, fallbackKey ?? '')
    const existing = db
      .select({ dismissed: schema.mail_link.dismissed })
      .from(schema.mail_link)
      .where(
        and(
          eq(schema.mail_link.mail_account_id, input.accountId),
          sameMessage,
          eq(schema.mail_link.entity_type, input.entityType),
          eq(schema.mail_link.entity_id, input.entityId)
        )
      )
      .all()
    // A dismissed link stays dismissed: the user removed it on purpose
    if (existing.length > 0) return 0
    db.insert(schema.mail_link)
      .values({
        mail_account_id: input.accountId,
        message_id: messageId,
        fallback_key: fallbackKey,
        entity_type: input.entityType,
        entity_id: input.entityId,
        source: input.source
      })
      .run()
    return 1
  }

  /**
   * One linking run: mails after the stored cursor, in batches, yielding between
   * them so a large mailbox never blocks the main process. A store rebuild (the
   * cursor points past the newest row) restarts from 0; the unique index makes
   * re-linking harmless.
   */
  async linkAccount(
    accountId: string,
    ownEmail: string
  ): Promise<{ linked: number; scanned: number }> {
    let cursor = this.cursorFor(accountId)
    // A rebuild of the store (or a full re-sync) inserts the mails again with fresh,
    // higher row ids, so a stored cursor would skip them forever. The cursor is only
    // trusted while the store still holds a mail at or below it.
    if (cursor > 0 && !(await this.storeHasRowAt(accountId, cursor))) {
      cursor = 0
      this.saveCursor(accountId, 0)
    }
    let linked = 0
    let scanned = 0
    for (;;) {
      const batch = (await mailClient.call('listHeadersSince', [
        cursor,
        LINK_BATCH,
        accountId
      ])) as MessageHeader[]
      if (batch.length === 0) break
      linked += this.linkBatch(accountId, ownEmail, batch)
      scanned += batch.length
      cursor = batch[batch.length - 1].id
      this.saveCursor(accountId, cursor)
      // Yield: the sync must never wait for the linker
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { linked, scanned }
  }

  /** Whether the store still holds a mail at or below the cursor (else it was rebuilt) */
  private async storeHasRowAt(accountId: string, cursor: number): Promise<boolean> {
    try {
      const rows = (await mailClient.call('listHeadersSince', [
        Math.max(0, cursor - 1),
        1,
        accountId
      ])) as MessageHeader[]
      return rows.length > 0 && rows[0].id <= cursor
    } catch {
      // Cannot tell: keep the cursor, re-linking is harmless
      return true
    }
  }

  /** The mails linked to one record, for the history panel of C3 */
  messagesFor(
    entityType: MailLinkEntityType,
    entityId: number,
    accountId: string
  ): { messageId: string; source: MailLinkSource }[] {
    const rows = db
      .select({ message_id: schema.mail_link.message_id, source: schema.mail_link.source })
      .from(schema.mail_link)
      .where(
        and(
          eq(schema.mail_link.mail_account_id, accountId),
          eq(schema.mail_link.entity_type, entityType),
          eq(schema.mail_link.entity_id, entityId),
          eq(schema.mail_link.dismissed, false),
          isNotNull(schema.mail_link.message_id)
        )
      )
      .all()
    return rows.map((r) => ({ messageId: r.message_id!, source: r.source }))
  }

  /** "Zuordnen…" with a picked record, or a link the user added by hand */
  linkManually(input: {
    accountId: string
    messageId: string
    entityType: MailLinkEntityType
    entityId: number
  }): number {
    return this.insertLink({ ...input, fallbackKey: null, source: 'manual' })
  }

  /** Removing a link: dismissed links are never added again automatically */
  dismissLink(id: number): void {
    db.update(schema.mail_link).set({ dismissed: true }).where(eq(schema.mail_link.id, id)).run()
  }
}
