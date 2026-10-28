import { createHash } from 'crypto'
import { injectable, inject } from 'tsyringe'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema, type MailLinkEntityType, type MailLinkSource } from '../db/schema'
import { mailClient } from '../mailclient/MailClientService'
import type { HeaderPage } from '../mailclient/core/types'
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

/** The records a mail can be linked to by hand ("Zuordnen…"); an event is a deal memo */
export const MANUAL_LINK_ENTITY_TYPES = ['person', 'company', 'venue', 'band', 'event'] as const
export type ManualLinkEntityType = (typeof MANUAL_LINK_ENTITY_TYPES)[number]
const MANUAL_LINK_TABLES = {
  person: schema.person,
  company: schema.company,
  venue: schema.venue,
  band: schema.band,
  event: schema.deal_memo
} as const

export type ResolvedOwner = { entityType: MailLinkEntityType; entityId: number }
export type ResolvedLink = { owner: ResolvedOwner; source: MailLinkSource }

/** The address lookups the linker needs, so resolution is testable without a DB */
export type AddressLookup = (address: string) => ResolvedOwner[]
/** The links already stored for a Message-ID, for thread inheritance */
export type ThreadLookup = (messageId: string) => ResolvedOwner[]

/** MR-28: where the linker stopped, a row id of one particular store */
export type LinkCursor = { generation: string | null; id: number }

/**
 * Host L3: the user's own addresses - every configured account's address, its login
 * when that is an address, and the further own addresses entered on it (a forwarder
 * such as info@). Mail between them links nothing.
 */
export function ownMailAddresses(
  accounts: { email: string; user: string; aliases?: readonly string[] }[]
): string[] {
  const out = new Set<string>()
  for (const account of accounts) {
    for (const value of [account.email, account.user, ...(account.aliases ?? [])]) {
      const address = (value ?? '').trim().toLowerCase()
      if (address.includes('@')) out.add(address)
    }
  }
  return [...out]
}

/** Every address of a mail, lower-cased and trimmed, without the user's own */
export function mailAddresses(
  header: Pick<LinkableHeader, 'fromEmail' | 'toEmails' | 'ccEmails'>,
  ownAddresses: readonly string[]
): string[] {
  const own = new Set(ownAddresses.map((a) => a.trim().toLowerCase()))
  return [header.fromEmail, ...header.toEmails, ...header.ccEmails]
    .map((a) => (a ?? '').trim().toLowerCase())
    .filter((a) => a.length > 0 && !own.has(a))
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
  ownAddresses: readonly string[],
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

  for (const address of mailAddresses(header, ownAddresses)) {
    for (const owner of lookupAddress(address)) add(owner, 'address')
  }
  for (const parent of threadParents(header)) {
    for (const owner of lookupThread(parent)) add(owner, 'thread')
  }
  return out
}

/** A mail-client event as main receives it; only the fields the trigger reads */
type MailClientEvent = {
  type?: string
  accountId?: string
  event?: { type?: string; path?: string; specialUse?: string | null }
}

/**
 * The folders whose mail is linked: INBOX and Sent, where the mails that matter arrive.
 * Sent is found by its special-use (MR-28), so "Gesendete Objekte" counts as well.
 */
export function linkableFolder(folder: { path?: string; specialUse?: string | null }): boolean {
  return folder.path?.toUpperCase() === 'INBOX' || folder.specialUse === '\\Sent'
}

/**
 * C2: runs the linker for an account. One run per account at a time; a request that
 * arrives during a run must not be dropped (the mails a folder event announced may have
 * been synced after the run's cursor passed them, a contact may have gained an address
 * after the run read them), so the run is repeated once instead. A failed run is logged
 * (MR-28), never swallowed.
 */
export function mailLinkRunner(deps: {
  link: (accountId: string) => Promise<unknown>
  log: (error: unknown) => void
}): { run: (accountId: string) => void; onEvent: (event: unknown) => void } {
  const running = new Set<string>()
  const again = new Set<string>()
  const run = (accountId: string): void => {
    if (running.has(accountId)) {
      again.add(accountId)
      return
    }
    running.add(accountId)
    void Promise.resolve()
      .then(() => deps.link(accountId))
      .catch((error) => deps.log(error))
      .finally(() => {
        running.delete(accountId)
        // Work that arrived during the run gets its own pass
        if (again.delete(accountId)) run(accountId)
      })
  }
  const onEvent = (event: unknown): void => {
    const e = event as MailClientEvent
    if (e.type !== 'sync-event' || e.event?.type !== 'folder-done') return
    if (!linkableFolder(e.event)) return
    if (!e.accountId) return
    run(e.accountId)
  }
  return { run, onEvent }
}

/** C2: the runner's event side - links after each folder sync of INBOX or Sent */
export function mailLinkTrigger(
  deps: Parameters<typeof mailLinkRunner>[0]
): (event: unknown) => void {
  return mailLinkRunner(deps).onEvent
}

@injectable()
export class MailLinkService {
  constructor(@inject(SettingsRepository) private settings: SettingsRepository) {}

  private cursorKey(accountId: string): string {
    return `mailLinkCursor:${accountId}`
  }

  /** Stored cursor per account; a missing or broken value starts at 0 of no store */
  cursorFor(accountId: string): LinkCursor {
    const start: LinkCursor = { generation: null, id: 0 }
    const raw = this.settings.getAll()[this.cursorKey(accountId)]
    if (raw === undefined) return start
    try {
      const parsed = JSON.parse(raw) as { generation?: unknown; id?: unknown } | null
      // The bare number of earlier builds names no store, so it is not trusted
      if (typeof parsed?.generation !== 'string' || typeof parsed.id !== 'number') return start
      if (!Number.isInteger(parsed.id) || parsed.id < 0) return start
      return { generation: parsed.generation, id: parsed.id }
    } catch {
      return start
    }
  }

  private saveCursor(accountId: string, cursor: LinkCursor): void {
    this.settings.setMany({ [this.cursorKey(accountId)]: JSON.stringify(cursor) })
  }

  private addressesKey(accountId: string): string {
    return `mailLinkAddresses:${accountId}`
  }

  /**
   * A digest of every contact address, primary and further ones. When it differs from
   * the one an account's linker last ran with, an address was added or changed, and
   * mail the cursor already passed may now belong to a record.
   */
  addressFingerprint(): string {
    const primary = db
      .select({ email: sql<string>`lower(trim(${schema.contact.email}))` })
      .from(schema.contact)
      .all()
    const others = db.select({ email: schema.contact_email.email }).from(schema.contact_email).all()
    const all = new Set([...primary, ...others].map((row) => row.email).filter(Boolean))
    return createHash('sha256')
      .update([...all].sort().join(' '))
      .digest('hex')
  }

  /** The records that own an address, capped so a shared mailbox links nothing */
  addressOwners(address: string): ResolvedOwner[] {
    const email = address.trim().toLowerCase()
    if (!email) return []
    // The primary address of a contact, or one of its further ones
    const primary = db
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(sql`lower(trim(${schema.contact.email})) = ${email}`)
      .all()
    const others = db
      .select({ id: schema.contact_email.contact_id })
      .from(schema.contact_email)
      .where(eq(schema.contact_email.email, email))
      .all()
    const ids = [...new Set([...primary, ...others].map((c) => c.id))]
    if (ids.length === 0) return []
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
    // Host L3: the cap counts records, not contacts - one contact can stand for many records
    return out.length > SHARED_ADDRESS_LIMIT ? [] : out
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
        and(
          eq(schema.mail_link.mail_account_id, accountId),
          eq(schema.mail_link.message_id, id),
          // MR-28: a link the user dismissed is not handed on to the replies
          eq(schema.mail_link.dismissed, false)
        )
      )
      .all()
    return rows.map((r) => ({ entityType: r.entity_type, entityId: r.entity_id }))
  }

  /**
   * One linking round over a batch of headers; returns how many links were added. The
   * batch is one transaction (MR-28): one commit instead of one per link, and a batch
   * that fails leaves nothing behind.
   */
  linkBatch(accountId: string, ownAddresses: readonly string[], headers: LinkableHeader[]): number {
    return db.transaction(() => {
      let added = 0
      for (const header of headers) {
        const links = resolveLinks(
          header,
          ownAddresses,
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
    })
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
   * them so a large mailbox never blocks the main process. The cursor names the
   * store it belongs to (MR-28): every row up to its id was linked, in that store
   * only. A rebuilt or replaced store has another generation, and the run starts
   * again from 0; the unique index makes re-linking harmless.
   *
   * The same restart follows a change of the contact addresses, so a contact that gained
   * one gets its older mail too. A rescan only adds: a link is never added twice, and a
   * dismissed one stays dismissed. Links an address made stay when it is removed.
   */
  async linkAccount(
    accountId: string,
    ownAddresses: readonly string[]
  ): Promise<{ linked: number; scanned: number }> {
    let { generation, id: cursor } = this.cursorFor(accountId)
    const addresses = this.addressFingerprint()
    const linkedWith = this.settings.getAll()[this.addressesKey(accountId)]
    if (linkedWith !== addresses) {
      // No digest yet (an account from before, or a new one): its cursor stands
      if (linkedWith !== undefined) cursor = 0
      this.settings.setMany({
        [this.cursorKey(accountId)]: JSON.stringify({ generation, id: cursor }),
        [this.addressesKey(accountId)]: addresses
      })
    }
    let linked = 0
    let scanned = 0
    for (;;) {
      const page = (await mailClient.call('listHeadersSince', [
        cursor,
        LINK_BATCH,
        accountId
      ])) as HeaderPage
      if (page.generation !== generation) {
        generation = page.generation
        // These ids belong to another store; the old position says nothing about them
        if (cursor > 0) {
          cursor = 0
          this.saveCursor(accountId, { generation, id: cursor })
          continue
        }
      }
      if (page.headers.length === 0) break
      linked += this.linkBatch(accountId, ownAddresses, page.headers)
      scanned += page.headers.length
      cursor = page.headers[page.headers.length - 1].id
      this.saveCursor(accountId, { generation, id: cursor })
      // Yield: the sync must never wait for the linker
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { linked, scanned }
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

  /**
   * "Zuordnen…" with a picked record. A link the user dismissed before comes back,
   * now as a manual one: picking the record again is the user changing their mind.
   * Returns 1 when the mail is now linked anew, 0 when it already was.
   */
  linkManually(input: {
    accountId: string
    messageId: string
    entityType: ManualLinkEntityType
    entityId: number
  }): number {
    const table = MANUAL_LINK_TABLES[input.entityType]
    const record = db.select({ id: table.id }).from(table).where(eq(table.id, input.entityId)).get()
    if (!record) throw new Error('Der Datensatz existiert nicht mehr')
    const messageId = input.messageId.replace(/^</, '').replace(/>$/, '').trim()
    if (!messageId)
      throw new Error('Diese Mail hat keine Message-ID und kann nicht zugeordnet werden')
    const restored = db
      .update(schema.mail_link)
      .set({ dismissed: false, source: 'manual' })
      .where(
        and(
          eq(schema.mail_link.mail_account_id, input.accountId),
          eq(schema.mail_link.message_id, messageId),
          eq(schema.mail_link.entity_type, input.entityType),
          eq(schema.mail_link.entity_id, input.entityId),
          eq(schema.mail_link.dismissed, true)
        )
      )
      .run()
    if (restored.changes > 0) return 1
    return this.insertLink({ ...input, messageId, fallbackKey: null, source: 'manual' })
  }

  /** Removing a link: dismissed links are never added again automatically */
  dismissLink(id: number): void {
    db.update(schema.mail_link).set({ dismissed: true }).where(eq(schema.mail_link.id, id)).run()
  }

  /** Undoes dismissLink: the link shows again and the linker treats it as before */
  restoreLink(id: number): void {
    db.update(schema.mail_link).set({ dismissed: false }).where(eq(schema.mail_link.id, id)).run()
  }
}
