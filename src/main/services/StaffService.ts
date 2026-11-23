import { injectable, inject } from 'tsyringe'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, getSqlite } from '../db'
import { schema } from '../db/schema'
import { randomPrefix } from '../sync/ids'
import { getMeta, hasBookkeeping } from '../sync/store'
import { FolderTransport } from '../sync/transport'
import {
  createChannel,
  dropChannel,
  getChannel,
  listChannels,
  revokeChannel,
  writeChannelSnapshot
} from '../staff/bridge'
import { computeStaffView } from '../staff/policy'
import { SyncService } from './SyncService'
import type {
  CreateEmployeeInput,
  EmployeeDto,
  SetStaffGrantInput,
  StaffGrantChoice,
  StaffGrantStateDto,
  StaffGrantTarget
} from '../api/schemas/staff.schema'

type EmployeeRow = typeof schema.employee.$inferSelect

/**
 * #262: employees, their folders and what is shared with them. The folders are served by the
 * staff bridge (staff/bridge.ts), run with every sync (SyncService.runBridges).
 */
@injectable()
export class StaffService {
  constructor(@inject(SyncService) private sync: SyncService) {}

  private thisDevice(): string | null {
    const sqlite = getSqlite()
    return hasBookkeeping(sqlite) ? getMeta(sqlite, 'device_id') : null
  }

  async list(): Promise<EmployeeDto[]> {
    const rows = db.select().from(schema.employee).orderBy(schema.employee.name).all()
    const channels = new Map(listChannels(getSqlite()).map((c) => [c.employee_id, c]))
    const device = this.thisDevice()
    return Promise.all(
      rows.map(async (row) => {
        const channel = channels.get(row.id)
        let joined = false
        if (channel) {
          joined = channel.staff_device !== null
          if (!joined) {
            try {
              const devices = await new FolderTransport(channel.folder).listDevices()
              joined = devices.some((d) => d.id !== channel.bridge_id)
            } catch {
              joined = false
            }
          }
        }
        return {
          id: row.id,
          name: row.name,
          idPrefix: row.id_prefix,
          bridgeDevice: row.bridge_device,
          bridgedHere: channel !== undefined && row.bridge_device === device,
          folder: channel?.folder ?? null,
          revokedAt: row.revoked_at,
          createdAt: row.created_at,
          lastChangeAt: channel?.last_change_at ?? null,
          joined,
          lastError: channel?.last_error ?? null
        }
      })
    )
  }

  /** A new employee, served from this computer through `folder` (an empty folder) */
  async create(input: CreateEmployeeInput): Promise<EmployeeDto> {
    const env = this.sync.bridgeEnv()
    const taken = [
      ...(await this.sync.takenPrefixes()),
      ...db
        .select({ prefix: schema.employee.id_prefix })
        .from(schema.employee)
        .all()
        .map((row) => row.prefix)
    ]
    const [row] = db
      .insert(schema.employee)
      .values({
        name: input.name,
        id_prefix: randomPrefix(taken),
        bridge_device: env.adminDevice
      })
      .returning()
      .all()
    try {
      await createChannel(
        env,
        { id: row.id, name: row.name, idPrefix: row.id_prefix },
        input.folder
      )
    } catch (error) {
      dropChannel(getSqlite(), row.id)
      db.delete(schema.employee).where(eq(schema.employee.id, row.id)).run()
      throw error
    }
    return (await this.list()).find((e) => e.id === row.id)!
  }

  /**
   * Takes the access away: the folder is no longer served and the employee's computer clears
   * the company's data at its next sync. What the employee created stays here.
   */
  async revoke(id: number): Promise<void> {
    const row = this.get(id)
    db.update(schema.employee)
      .set({ revoked_at: new Date().toISOString(), updated_at: sql`datetime('now')` })
      .where(eq(schema.employee.id, id))
      .run()
    if (getChannel(getSqlite(), row.id)) await revokeChannel(this.sync.bridgeEnv(), row.id)
  }

  /** Removes a revoked employee with their grants */
  remove(id: number): void {
    const row = this.get(id)
    if (!row.revoked_at) throw new Error('Bitte zuerst den Zugang entziehen.')
    dropChannel(getSqlite(), id)
    db.delete(schema.employee).where(eq(schema.employee.id, id)).run()
  }

  /** Writes the employee's starting point again (e.g. for a new computer of theirs) */
  async refreshSnapshot(id: number): Promise<void> {
    const row = this.get(id)
    await writeChannelSnapshot(this.sync.bridgeEnv(), {
      id: row.id,
      name: row.name,
      idPrefix: row.id_prefix
    })
  }

  private get(id: number): EmployeeRow {
    const row = db.select().from(schema.employee).where(eq(schema.employee.id, id)).get()
    if (!row) throw new Error('Diesen Mitarbeiter gibt es nicht mehr.')
    return row
  }

  // ---------- grants ----------

  grantState(target: StaffGrantTarget): StaffGrantStateDto {
    const grants = db
      .select()
      .from(schema.staff_grant)
      .where(
        and(
          eq(schema.staff_grant.entity, target.entity),
          eq(schema.staff_grant.entity_id, target.entityId)
        )
      )
      .all()
    const choiceOf = (employeeId: number | null): StaffGrantChoice =>
      (grants.find((g) => g.employee_id === employeeId)?.access as StaffGrantChoice | undefined) ??
      'default'
    const employees = db
      .select()
      .from(schema.employee)
      .where(isNull(schema.employee.revoked_at))
      .orderBy(schema.employee.name)
      .all()
    const sqlite = getSqlite()
    return {
      all: choiceOf(null),
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        choice: choiceOf(e.id),
        visible:
          computeStaffView(sqlite, { employeeId: e.id, idPrefix: e.id_prefix })
            .get(target.entity)
            ?.has(String(target.entityId)) ?? false
      }))
    }
  }

  setGrant(input: SetStaffGrantInput): StaffGrantStateDto {
    const where = and(
      input.employeeId === null
        ? isNull(schema.staff_grant.employee_id)
        : eq(schema.staff_grant.employee_id, input.employeeId),
      eq(schema.staff_grant.entity, input.entity),
      eq(schema.staff_grant.entity_id, input.entityId)
    )
    const existing = db.select().from(schema.staff_grant).where(where).get()
    if (input.choice === 'default') {
      if (existing)
        db.delete(schema.staff_grant).where(eq(schema.staff_grant.id, existing.id)).run()
    } else if (existing) {
      if (existing.access !== input.choice)
        db.update(schema.staff_grant)
          .set({ access: input.choice, updated_at: sql`datetime('now')` })
          .where(eq(schema.staff_grant.id, existing.id))
          .run()
    } else {
      db.insert(schema.staff_grant)
        .values({
          employee_id: input.employeeId,
          entity: input.entity,
          entity_id: input.entityId,
          access: input.choice
        })
        .run()
    }
    // the bridges send the change with the next sync run
    this.sync.nudge()
    return this.grantState(input)
  }

  /** Whether there are employees at all (the UI shows the grant controls only then) */
  hasEmployees(): boolean {
    return !!db
      .select({ id: schema.employee.id })
      .from(schema.employee)
      .where(isNull(schema.employee.revoked_at))
      .get()
  }
}
