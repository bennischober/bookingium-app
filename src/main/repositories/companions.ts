import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

/**
 * Address and contact rows belong to the person, company, venue or hotel pointing at them;
 * the foreign key runs from the owner, so deleting the owner (or pointing it at another row)
 * leaves the old row behind. #149: after such a write the repositories call this with the
 * ids the owner had, and a row goes once no owner references it any more.
 *
 * Done here rather than in triggers on purpose: a trigger on one table that names another
 * makes every later drizzle-kit table rebuild of that other table fail at its RENAME.
 * Shared rows (the API takes an existing addressId/contactId, and old demo data shares
 * addresses) survive until their last owner is gone. Banks are not companions: they are
 * records of their own (Banken page), picked by several companies.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ADDRESS_OWNERS = [schema.person, schema.company, schema.venue, schema.hotel] as const

function addressInUse(tx: Tx, id: number): boolean {
  return ADDRESS_OWNERS.some(
    (table) =>
      tx
        .select({ one: sql`1` })
        .from(table)
        .where(eq(table.address_id, id))
        .limit(1)
        .get() !== undefined
  )
}

function contactInUse(tx: Tx, id: number): boolean {
  return ADDRESS_OWNERS.some(
    (table) =>
      tx
        .select({ one: sql`1` })
        .from(table)
        .where(eq(table.contact_id, id))
        .limit(1)
        .get() !== undefined
  )
}

/** Deletes the given address and contact rows that no owner references any more */
export function deleteUnusedCompanions(
  tx: Tx,
  previous: { address_id: number | null; contact_id: number | null }
): void {
  if (previous.address_id !== null && !addressInUse(tx, previous.address_id)) {
    tx.delete(schema.address).where(eq(schema.address.id, previous.address_id)).run()
  }
  // contact_email rows go with the contact (ON DELETE CASCADE)
  if (previous.contact_id !== null && !contactInUse(tx, previous.contact_id)) {
    tx.delete(schema.contact).where(eq(schema.contact.id, previous.contact_id)).run()
  }
}
