import { and, eq, sql } from 'drizzle-orm'
import { schema } from '../db/schema'
import type { Reader, Tx } from './tx'
import type { StaffGrantEntity } from '../api/schemas/staff.schema'

// #262: grants written outside the share button: an uploaded contact list shares its records
// with an employee, a duplicate the employee created is merged into the record it repeats.

/** Throws unless the employee exists and still has access */
export function assertActiveEmployee(reader: Reader, employeeId: number): void {
  const employee = reader
    .select({ revokedAt: schema.employee.revoked_at })
    .from(schema.employee)
    .where(eq(schema.employee.id, employeeId))
    .get()
  if (!employee) throw new Error('Diesen Mitarbeiter gibt es nicht mehr.')
  if (employee.revokedAt) throw new Error('Diesem Mitarbeiter wurde der Zugang entzogen.')
}

/**
 * Shares records with an employee: a grant "shared" for them, replacing one that made a record
 * internal for them. Returns how many different records are shared.
 */
export function shareRecords(
  tx: Tx,
  employeeId: number,
  entity: StaffGrantEntity,
  ids: Iterable<number>
): number {
  let shared = 0
  for (const entityId of new Set(ids)) {
    const where = and(
      eq(schema.staff_grant.employee_id, employeeId),
      eq(schema.staff_grant.entity, entity),
      eq(schema.staff_grant.entity_id, entityId)
    )
    const existing = tx.select().from(schema.staff_grant).where(where).get()
    if (!existing) {
      tx.insert(schema.staff_grant)
        .values({ employee_id: employeeId, entity, entity_id: entityId, access: 'shared' })
        .run()
    } else if (existing.access !== 'shared') {
      tx.update(schema.staff_grant)
        .set({ access: 'shared', updated_at: sql`datetime('now')` })
        .where(eq(schema.staff_grant.id, existing.id))
        .run()
    }
    shared++
  }
  return shared
}
