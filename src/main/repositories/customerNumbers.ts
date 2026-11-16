import { and, eq, ne } from 'drizzle-orm'
import { schema } from '../db/schema'
import type { Reader } from './tx'

/** The record kinds that can carry a Kundennummer (one number space across all three) */
export type CustomerOwner = { kind: 'company' | 'band' | 'person'; id: number | null }

const TABLES = { company: schema.company, band: schema.band, person: schema.person } as const
const LABELS = { company: 'der Firma', band: 'der Band', person: 'der Person' } as const

/**
 * Refuses a Kundennummer another company, band or person already has. `owner` is the record
 * being saved (id null while it is created), which may keep its own number.
 */
export function assertCustomerNumberFree(
  reader: Reader,
  number: number | null | undefined,
  owner: CustomerOwner
) {
  if (number == null) return
  for (const [kind, table] of Object.entries(TABLES) as Array<
    [CustomerOwner['kind'], (typeof TABLES)[CustomerOwner['kind']]]
  >) {
    const self = kind === owner.kind && owner.id !== null
    const taken = reader
      .select({ id: table.id })
      .from(table)
      .where(
        self
          ? and(eq(table.customer_number, number), ne(table.id, owner.id as number))
          : eq(table.customer_number, number)
      )
      .get()
    if (taken)
      throw new Error(`Die Kundennummer ${number} gehört schon ${LABELS[kind]} #${taken.id}`)
  }
}
