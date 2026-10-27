import { EventEmitter } from 'events'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

/**
 * A contact's further email addresses (`contact_email`). `contact.email` stays the
 * primary address; the others are read with every contact and written by the
 * person, company, venue and hotel repositories through these helpers.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ContactRow = typeof schema.contact.$inferSelect
export type ContactWithEmails = ContactRow & { other_emails: string[] }

/**
 * Emits 'saved' when a contact's addresses were written, so the mail linker can look for
 * mail of an address the contact gained. The linker runs later, after the write committed.
 */
export const contactAddressEvents = new EventEmitter()

/** One stored form of an address: trimmed and lower-cased */
export function normalizeEmail(address: string): string {
  return address.trim().toLowerCase()
}

/**
 * The further addresses as stored: normalized, without empties, without
 * duplicates and without the primary address, in the order given.
 */
export function normalizeOtherEmails(primary: string, others: readonly string[]): string[] {
  const seen = new Set<string>([normalizeEmail(primary)])
  const out: string[] = []
  for (const address of others) {
    const email = normalizeEmail(address)
    if (!email || seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

/**
 * Replaces a contact's further addresses. `undefined` keeps the stored ones, so
 * callers that do not edit them (imports, older forms) cannot wipe them.
 */
export function saveContactEmails(
  tx: Tx,
  contactId: number,
  primary: string,
  others: readonly string[] | undefined
): void {
  contactAddressEvents.emit('saved')
  if (others === undefined) {
    // The primary may have become one of the further addresses; it is not kept twice
    const email = normalizeEmail(primary)
    if (email) {
      tx.delete(schema.contact_email)
        .where(
          and(eq(schema.contact_email.contact_id, contactId), eq(schema.contact_email.email, email))
        )
        .run()
    }
    return
  }
  tx.delete(schema.contact_email).where(eq(schema.contact_email.contact_id, contactId)).run()
  const emails = normalizeOtherEmails(primary, others)
  if (emails.length === 0) return
  tx.insert(schema.contact_email)
    .values(emails.map((email, position) => ({ contact_id: contactId, email, position })))
    .run()
}

/** The further addresses of some contacts, in form order */
export function otherEmailsByContact(contactIds: number[], reader: Tx = db as unknown as Tx) {
  const out = new Map<number, string[]>()
  if (contactIds.length === 0) return out
  const rows = reader
    .select({ contact_id: schema.contact_email.contact_id, email: schema.contact_email.email })
    .from(schema.contact_email)
    .where(inArray(schema.contact_email.contact_id, [...new Set(contactIds)]))
    .orderBy(asc(schema.contact_email.contact_id), asc(schema.contact_email.position))
    .all()
  for (const row of rows) {
    const list = out.get(row.contact_id) ?? []
    list.push(row.email)
    out.set(row.contact_id, list)
  }
  return out
}

/** Adds `other_emails` to the contact of each row, with one query for all of them */
export function withContactEmails<T extends { contact: ContactRow | null }>(
  rows: T[],
  reader: Tx = db as unknown as Tx
): (Omit<T, 'contact'> & { contact: ContactWithEmails | null })[] {
  const ids = rows.flatMap((row) => (row.contact ? [row.contact.id] : []))
  const byContact = otherEmailsByContact(ids, reader)
  return rows.map((row) => ({
    ...row,
    contact: row.contact
      ? { ...row.contact, other_emails: byContact.get(row.contact.id) ?? [] }
      : null
  }))
}
