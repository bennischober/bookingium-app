import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { RecipientCandidate } from '../mail/recipientLookup'

/**
 * Every address the app itself knows: persons, companies and the venue's own contact.
 *
 * The mail core cannot read this database (it is dependency-free by design), so the host gathers
 * these and merges them with the addresses the mail store remembers from message headers. Without
 * this, a person you have on file but never mailed is invisible in the compose dropdown - the exact
 * case the lookup exists for.
 *
 * Everything is returned unfiltered: the merge owns the matching, the ranking and the empty-address
 * rule, so the query stays a plain read and the behaviour is testable without a database.
 */
@injectable()
export class RecipientLookupRepository {
  loadCandidates(): RecipientCandidate[] {
    const out: RecipientCandidate[] = []

    // Persons: the address hangs off the shared contact row
    for (const row of db
      .select({
        first: schema.person.first_name,
        last: schema.person.last_name,
        email: schema.contact.email
      })
      .from(schema.person)
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .all()) {
      const name = `${row.first} ${row.last}`.trim()
      out.push({ name, email: row.email ?? '', source: 'person' })
    }

    // Companies: the agency itself is a recipient ("BMM"), so its name matters as much as a person's
    for (const row of db
      .select({ name: schema.company.name, email: schema.contact.email })
      .from(schema.company)
      .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
      .all()) {
      out.push({ name: row.name, email: row.email ?? '', source: 'company' })
    }

    // Venues: their own address, e.g. the club you are writing to
    for (const row of db
      .select({ name: schema.venue.name, email: schema.contact.email })
      .from(schema.venue)
      .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .all()) {
      out.push({ name: row.name, email: row.email ?? '', source: 'venue' })
    }

    return out
  }
}

/**
 * Addresses the mail store has seen in message headers, as merge candidates.
 *
 * These rank below every app record: an address you actually have on file should never be labelled
 * "from mail".
 */
export function mailCandidates(
  rows: readonly { name: string; email: string }[]
): RecipientCandidate[] {
  return rows.map((row) => ({ name: row.name, email: row.email, source: 'mail' as const }))
}
