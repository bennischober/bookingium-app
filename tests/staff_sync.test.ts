// #262: an employee's computer, served through its own folder by the staff bridge of an admin
// computer. Real databases (copies of a migrated template), real folders, the real join.

import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { schema } from '../src/main/db/schema'
import { SyncEngine, createGroup } from '../src/main/sync/engine'
import { prepareJoin } from '../src/main/sync/join'
import { FolderTransport } from '../src/main/sync/transport'
import { configureRowIds, idRange } from '../src/main/sync/ids'
import { applyStagedRestore, stageRestore } from '../src/main/backup/files'
import {
  createChannel,
  getChannel,
  revokeChannel,
  runChannel,
  type BridgeEnv,
  type EmployeeRef
} from '../src/main/staff/bridge'
import { computeStaffView, tablesWithoutRule } from '../src/main/staff/policy'

const MIGRATIONS = resolve(__dirname, '../src/main/db/migrations')
const SCHEMA = 1
const STAFF_PREFIX = 777

type Computer = {
  name: string
  root: string
  dataDir: string
  storageDir: string
  workDir: string
  sqlite: Database.Database
  db: ReturnType<typeof drizzle<typeof schema>>
  engine: SyncEngine | null
}

let base: string
let shared: string
let staffFolder: string
let clockMs: number
let opened: Database.Database[] = []
let template: string
let templateDir: string

function openComputer(name: string): Computer {
  const root = join(base, name)
  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(root, 'storage'), { recursive: true })
  copyFileSync(template, join(dataDir, 'bookingum.db'))
  const sqlite = new Database(join(dataDir, 'bookingum.db'))
  opened.push(sqlite)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return {
    name,
    root,
    dataDir,
    storageDir: join(root, 'storage'),
    workDir: join(root, 'backup'),
    sqlite,
    db: drizzle(sqlite, { schema }),
    engine: null
  }
}

function engineOptions(c: Computer, folder: string) {
  return {
    sqlite: c.sqlite,
    transport: new FolderTransport(folder),
    storageDir: c.storageDir,
    schema: SCHEMA,
    appVersion: 'test',
    deviceName: c.name,
    removeFile: async (file: string) => unlinkSync(file),
    now: () => new Date((clockMs += 1000))
  }
}

function as<T>(c: Computer, work: () => T): T {
  if (c.engine) c.engine.useRowIds()
  else configureRowIds(null)
  try {
    return work()
  } finally {
    configureRowIds(null)
  }
}

async function run(c: Computer) {
  c.engine!.useRowIds()
  try {
    return await c.engine!.run()
  } finally {
    configureRowIds(null)
  }
}

function env(admin: Computer): BridgeEnv {
  return {
    sqlite: admin.sqlite,
    storageDir: admin.storageDir,
    schema: SCHEMA,
    appVersion: 'test',
    deviceName: admin.name,
    adminDevice: admin.engine!.deviceId,
    adminPrefix: admin.engine!.prefix,
    workDir: admin.workDir,
    now: () => new Date((clockMs += 1000))
  }
}

/** The employee's computer joins its folder and "restarts" */
async function joinStaff(c: Computer): Promise<Computer> {
  await prepareJoin({
    transport: new FolderTransport(staffFolder),
    liveSqlite: c.sqlite,
    liveStorage: c.storageDir,
    workDir: c.workDir,
    schema: SCHEMA,
    migrate: () => {}
  })
  c.sqlite.close()
  await stageRestore(c.workDir)
  const outcome = applyStagedRestore({
    dataDir: c.dataDir,
    storageDir: c.storageDir,
    workDir: c.workDir
  })
  expect(outcome?.error).toBeNull()
  const sqlite = new Database(join(c.dataDir, 'bookingum.db'))
  sqlite.pragma('foreign_keys = ON')
  opened.push(sqlite)
  const next: Computer = { ...c, sqlite, db: drizzle(sqlite, { schema }), engine: null }
  next.engine = new SyncEngine(engineOptions(next, staffFolder))
  next.engine.activate()
  configureRowIds(null)
  return next
}

const count = (c: Computer, table: string, where = '1') =>
  (c.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n
const has = (c: Computer, table: string, id: number) => count(c, table, `id = ${id}`) === 1

beforeAll(() => {
  templateDir = mkdtempSync(join(tmpdir(), 'bookingium-staff-template-'))
  template = join(templateDir, 'bookingum.db')
  const sqlite = new Database(template)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS })
  sqlite.close()
})

afterAll(() => {
  rmSync(templateDir, { recursive: true, force: true })
})

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bookingium-staff-'))
  shared = join(base, 'OneDrive', 'Bookingium')
  staffFolder = join(base, 'OneDrive', 'Bookingium Mitarbeiter Muster')
  mkdirSync(shared, { recursive: true })
  mkdirSync(staffFolder, { recursive: true })
  clockMs = Date.UTC(2026, 10, 1)
})

afterEach(() => {
  configureRowIds(null)
  for (const sqlite of opened) if (sqlite.open) sqlite.close()
  opened = []
  rmSync(base, { recursive: true, force: true })
})

/** The company's data: one shared band with an event, one not shared, money and management */
function seed(admin: Computer) {
  return as(admin, () => {
    const d = admin.db
    const agency = d
      .insert(schema.company)
      .values({ name: 'Beispiel Booking GmbH' })
      .returning()
      .get()
    const shared = d
      .insert(schema.band)
      .values({ name: 'Muster Band', company_id: agency.id })
      .returning()
      .get()
    const other = d
      .insert(schema.band)
      .values({ name: 'Andere Band', company_id: agency.id })
      .returning()
      .get()
    const sharedEvent = d
      .insert(schema.deal_memo)
      .values({ name: 'Konzert Muster', date: '2027-03-01', band_id: shared.id, deal: '70/30' })
      .returning()
      .get()
    const otherEvent = d
      .insert(schema.deal_memo)
      .values({ name: 'Geheimes Konzert Andere', date: '2027-04-01', band_id: other.id })
      .returning()
      .get()
    d.insert(schema.itinerary).values({ deal_memo_id: sharedEvent.id }).run()
    const management = d
      .insert(schema.management_contract)
      .values({ band_id: shared.id })
      .returning()
      .get()
    const invoice = d
      .insert(schema.invoice)
      .values({ company_id: agency.id, deal_memo_id: sharedEvent.id, notes: 'Marge 15 %' })
      .returning()
      .get()
    mkdirSync(join(admin.storageDir, 'documents'), { recursive: true })
    writeFileSync(join(admin.storageDir, 'documents', 'rider.pdf'), 'rider content')
    writeFileSync(join(admin.storageDir, 'documents', 'kalkulation.pdf'), 'internal numbers')
    const rider = d
      .insert(schema.document)
      .values({
        owner_type: 'event',
        owner_id: sharedEvent.id,
        file_name: 'rider.pdf',
        file_type: 'application/pdf',
        file_path: 'documents/rider.pdf',
        file_size: 13
      })
      .returning()
      .get()
    const calculation = d
      .insert(schema.document)
      .values({
        owner_type: 'event',
        owner_id: sharedEvent.id,
        file_name: 'kalkulation.pdf',
        file_type: 'application/pdf',
        file_path: 'documents/kalkulation.pdf',
        file_size: 16
      })
      .returning()
      .get()
    const invoicePdf = d
      .insert(schema.document)
      .values({
        owner_type: 'event',
        owner_id: sharedEvent.id,
        file_name: 'rechnung.pdf',
        file_type: 'application/pdf',
        file_path: 'documents/rechnung.pdf',
        file_size: 10,
        document_type: 'invoice'
      })
      .returning()
      .get()
    const employee = d
      .insert(schema.employee)
      .values({ name: 'Erika Muster', id_prefix: STAFF_PREFIX })
      .returning()
      .get()
    d.insert(schema.staff_grant)
      .values({ employee_id: employee.id, entity: 'band', entity_id: shared.id, access: 'shared' })
      .run()
    // internal for everybody, although filed at a shared event
    d.insert(schema.staff_grant)
      .values({
        employee_id: null,
        entity: 'document',
        entity_id: calculation.id,
        access: 'internal'
      })
      .run()
    return {
      agency: agency.id,
      shared: shared.id,
      other: other.id,
      sharedEvent: sharedEvent.id,
      otherEvent: otherEvent.id,
      management: management.id,
      invoice: invoice.id,
      rider: rider.id,
      calculation: calculation.id,
      invoicePdf: invoicePdf.id,
      employee: { id: employee.id, name: employee.name, idPrefix: STAFF_PREFIX } as EmployeeRef
    }
  })
}

async function setUpAdmin() {
  const admin = openComputer('Buero')
  admin.engine = await createGroup(engineOptions(admin, shared), join(admin.root, 'snap.db'))
  configureRowIds(null)
  const ids = seed(admin)
  await run(admin)
  return { admin, ids }
}

describe('staff policy', () => {
  it('has a rule for every synced table', async () => {
    const { admin } = await setUpAdmin()
    expect(tablesWithoutRule(admin.sqlite)).toEqual([])
  })

  it('shows the booking work of shared bands, nothing of money or management', async () => {
    const { admin, ids } = await setUpAdmin()
    const view = computeStaffView(admin.sqlite, {
      employeeId: ids.employee.id,
      idPrefix: STAFF_PREFIX
    })
    // the other band is a contact that is neither shared nor linked
    expect(view.get('band')?.size).toBe(1)
    expect(view.get('deal_memo')?.has(String(ids.sharedEvent))).toBe(true)
    expect(view.get('deal_memo')?.has(String(ids.otherEvent))).toBe(false)
    expect(view.get('itinerary')?.size).toBe(1)
    expect(view.get('management_contract')?.size).toBe(0)
    expect(view.get('invoice')?.size).toBe(0)
    expect(view.get('document')?.has(String(ids.rider))).toBe(true)
    expect(view.get('document')?.has(String(ids.calculation))).toBe(false)
    expect(view.get('employee')?.size).toBe(0)
    // an invoice filed at the shared event as a PDF stays internal
    expect(view.get('document')?.has(String(ids.invoicePdf))).toBe(false)
    expect(view.get('staff_grant')?.size).toBe(0)
  })

  it('shows only shared contacts and the ones visible records need', async () => {
    const { admin, ids } = await setUpAdmin()
    const c = as(admin, () => {
      const d = admin.db
      const person = (first: string, street = '') =>
        d
          .insert(schema.person)
          .values({
            first_name: first,
            last_name: 'Muster',
            address_id: street
              ? d.insert(schema.address).values({ street }).returning().get().id
              : null
          })
          .returning()
          .get().id
      const promoter = d
        .insert(schema.company)
        .values({ name: 'Beispiel Konzerte' })
        .returning()
        .get().id
      const club = d
        .insert(schema.venue)
        .values({ name: 'Musterclub', company_id: promoter })
        .returning()
        .get().id
      const clubContact = person('Clara', 'Clubweg')
      d.insert(schema.venue_member).values({ venue_id: club, person_id: clubContact }).run()
      d.update(schema.deal_memo)
        .set({ venue_id: club })
        .where(eq(schema.deal_memo.id, ids.sharedEvent))
        .run()
      const stranger = person('Fremd', 'Geheimweg')
      const sharedPerson = person('Gabi')
      const secretMember = person('Intern')
      d.insert(schema.band_member).values({ band_id: ids.shared, person_id: secretMember }).run()
      const list = d
        .insert(schema.contact_list)
        .values({ name: 'Presse', kind: 'members' })
        .returning()
        .get().id
      const listPerson = person('Petra')
      d.insert(schema.contact_list_member)
        .values({ contact_list_id: list, person_id: listPerson })
        .run()
      const grant = (entity: string, entityId: number, access: 'shared' | 'internal') =>
        d
          .insert(schema.staff_grant)
          .values({ employee_id: ids.employee.id, entity, entity_id: entityId, access })
          .run()
      grant('person', sharedPerson, 'shared')
      grant('person', secretMember, 'internal')
      grant('contact_list', list, 'shared')
      return { promoter, club, clubContact, stranger, sharedPerson, secretMember, list, listPerson }
    })
    const view = computeStaffView(admin.sqlite, {
      employeeId: ids.employee.id,
      idPrefix: STAFF_PREFIX
    })
    const sees = (table: string, id: number) => view.get(table)?.has(String(id)) ?? false
    // linked: the club of the shared event, its promoter and contact person, the band's company
    expect(sees('venue', c.club)).toBe(true)
    expect(sees('company', c.promoter)).toBe(true)
    expect(sees('person', c.clubContact)).toBe(true)
    expect(sees('company', ids.agency)).toBe(true)
    // shared one by one, or as the records of a shared mailing list
    expect(sees('person', c.sharedPerson)).toBe(true)
    expect(sees('contact_list', c.list)).toBe(true)
    expect(sees('person', c.listPerson)).toBe(true)
    // neither shared nor linked, or internal although a member of the shared band
    expect(sees('person', c.stranger)).toBe(false)
    expect(sees('person', c.secretMember)).toBe(false)
    expect(view.get('band_member')?.size).toBe(0)
    // addresses go with their contact only
    const streets = [...(view.get('address')?.values() ?? [])].map((row) => row.street)
    expect(streets).toContain('Clubweg')
    expect(streets).not.toContain('Geheimweg')
  })
})

describe('staff bridge', { timeout: 60_000 }, () => {
  it('the employee joins a filtered copy, vacuumed, as a locked staff computer', async () => {
    const { admin, ids } = await setUpAdmin()
    await createChannel(env(admin), ids.employee, staffFolder)

    // nothing hidden is readable in the starting point's file
    const snapshots = join(staffFolder, 'startstand')
    const [snapshotName] = readdirSync(snapshots).filter((n) => !n.startsWith('.'))
    const raw = readFileSync(join(snapshots, snapshotName, 'bookingum.db'))
    expect(raw.includes(Buffer.from('Geheimes Konzert Andere'))).toBe(false)
    expect(raw.includes(Buffer.from('Marge 15 %'))).toBe(false)
    expect(raw.includes(Buffer.from('Erika Muster'))).toBe(false)
    expect(
      existsSync(join(snapshots, snapshotName, 'storage', 'documents', 'kalkulation.pdf'))
    ).toBe(false)

    const staff = await joinStaff(openComputer('Laptop Erika'))
    expect(staff.engine!.prefix).toBe(STAFF_PREFIX)
    expect(count(staff, 'band')).toBe(1)
    expect(has(staff, 'deal_memo', ids.sharedEvent)).toBe(true)
    expect(has(staff, 'deal_memo', ids.otherEvent)).toBe(false)
    expect(count(staff, 'management_contract')).toBe(0)
    expect(count(staff, 'invoice')).toBe(0)
    expect(count(staff, 'employee')).toBe(0)
    expect(count(staff, 'staff_grant')).toBe(0)
    expect(has(staff, 'document', ids.rider)).toBe(true)
    expect(readFileSync(join(staff.storageDir, 'documents', 'rider.pdf'), 'utf-8')).toBe(
      'rider content'
    )
    expect(existsSync(join(staff.storageDir, 'documents', 'kalkulation.pdf'))).toBe(false)
    expect(count(staff, 'app_setting', "key = 'staffDevice' AND value = 'true'")).toBe(1)
  })

  it('a later grant arrives, a record made internal leaves again', async () => {
    const { admin, ids } = await setUpAdmin()
    await createChannel(env(admin), ids.employee, staffFolder)
    const staff = await joinStaff(openComputer('Laptop Erika'))
    await run(staff)

    as(admin, () => {
      admin.db
        .insert(schema.staff_grant)
        .values({
          employee_id: ids.employee.id,
          entity: 'deal_memo',
          entity_id: ids.otherEvent,
          access: 'shared'
        })
        .run()
      admin.db
        .insert(schema.staff_grant)
        .values({
          employee_id: null,
          entity: 'deal_memo',
          entity_id: ids.sharedEvent,
          access: 'internal'
        })
        .run()
    })
    await runChannel(env(admin), ids.employee)
    await run(staff)
    expect(has(staff, 'deal_memo', ids.otherEvent)).toBe(true)
    expect(has(staff, 'deal_memo', ids.sharedEvent)).toBe(false)
    // with the event, its itinerary and its documents go
    expect(count(staff, 'itinerary')).toBe(0)
    expect(has(staff, 'document', ids.rider)).toBe(false)
    expect(existsSync(join(staff.storageDir, 'documents', 'rider.pdf'))).toBe(false)
  })

  it("takes the employee's allowed changes and passes them on to the other admin computers", async () => {
    const { admin, ids } = await setUpAdmin()
    await createChannel(env(admin), ids.employee, staffFolder)
    const staff = await joinStaff(openComputer('Laptop Erika'))
    await run(staff)

    // edit a shared event, create an own event, an own document
    as(staff, () =>
      staff.db
        .update(schema.deal_memo)
        .set({ notes: 'Catering geklärt' })
        .where(eq(schema.deal_memo.id, ids.sharedEvent))
        .run()
    )
    const own = as(staff, () =>
      staff.db
        .insert(schema.deal_memo)
        .values({ name: 'Neues Konzert', date: '2027-05-01', band_id: ids.shared })
        .returning()
        .get()
    )
    mkdirSync(join(staff.storageDir, 'documents'), { recursive: true })
    writeFileSync(join(staff.storageDir, 'documents', 'vertrag-neu.pdf'), 'signed')
    as(staff, () =>
      staff.db
        .insert(schema.document)
        .values({
          owner_type: 'event',
          owner_id: own.id,
          file_name: 'vertrag-neu.pdf',
          file_type: 'application/pdf',
          file_path: 'documents/vertrag-neu.pdf',
          file_size: 6
        })
        .run()
    )
    expect(own.id).toBeGreaterThanOrEqual(idRange(STAFF_PREFIX).first)
    await run(staff)

    const result = await runChannel(env(admin), ids.employee)
    expect(result.refused).toBe(0)
    expect(result.applied).toBeGreaterThanOrEqual(3)
    expect(
      (
        admin.sqlite.prepare('SELECT notes FROM deal_memo WHERE id = ?').get(ids.sharedEvent) as {
          notes: string
        }
      ).notes
    ).toBe('Catering geklärt')
    expect(has(admin, 'deal_memo', own.id)).toBe(true)
    expect(readFileSync(join(admin.storageDir, 'documents', 'vertrag-neu.pdf'), 'utf-8')).toBe(
      'signed'
    )
    // recorded as this computer's own change: the next sync run sends it to the others
    expect(count(admin, 'sync_change', `tbl = 'deal_memo' AND pk = '${own.id}'`)).toBe(1)
    expect(getChannel(admin.sqlite, ids.employee.id)?.last_error).toBeNull()
  })

  it('refuses deleting what is not own and issuing invoices, and puts it back', async () => {
    const { admin, ids } = await setUpAdmin()
    await createChannel(env(admin), ids.employee, staffFolder)
    const staff = await joinStaff(openComputer('Laptop Erika'))
    await run(staff)

    // an own draft invoice is fine, issuing it is not; deleting the company's event is not
    const invoice = as(staff, () =>
      staff.db
        .insert(schema.invoice)
        .values({ company_id: ids.agency, deal_memo_id: ids.sharedEvent })
        .returning()
        .get()
    )
    await run(staff)
    await runChannel(env(admin), ids.employee)
    expect(has(admin, 'invoice', invoice.id)).toBe(true)

    as(staff, () => {
      staff.db
        .update(schema.invoice)
        .set({ status: 'issued', invoice_number: 1 })
        .where(eq(schema.invoice.id, invoice.id))
        .run()
      staff.sqlite.prepare('DELETE FROM itinerary').run()
      staff.sqlite.prepare('DELETE FROM document').run()
    })
    await run(staff)
    const result = await runChannel(env(admin), ids.employee)
    expect(result.refused).toBeGreaterThanOrEqual(2)
    expect(
      (
        admin.sqlite.prepare('SELECT status FROM invoice WHERE id = ?').get(invoice.id) as {
          status: string
        }
      ).status
    ).toBe('draft')
    expect(count(admin, 'itinerary')).toBe(1)
    expect(has(admin, 'document', ids.rider)).toBe(true)

    // the bridge sends the true state back
    await run(staff)
    expect(
      staff.sqlite
        .prepare('SELECT status, invoice_number FROM invoice WHERE id = ?')
        .get(invoice.id) as {
        status: string
        invoice_number: number | null
      }
    ).toEqual({ status: 'draft', invoice_number: null })
    expect(count(staff, 'itinerary')).toBe(1)
    expect(has(staff, 'document', ids.rider)).toBe(true)
  })

  it('after a restored backup on the admin computer, numbering goes on and nothing is lost', async () => {
    const { admin, ids } = await setUpAdmin()
    await createChannel(env(admin), ids.employee, staffFolder)
    const staff = await joinStaff(openComputer('Laptop Erika'))
    await run(staff)
    const before = getChannel(admin.sqlite, ids.employee.id)!.export_seq

    as(admin, () =>
      admin.db
        .update(schema.band)
        .set({ name: 'Muster Band (neu)' })
        .where(eq(schema.band.id, ids.shared))
        .run()
    )
    await runChannel(env(admin), ids.employee)
    // the restore: this database is back at the earlier number
    admin.sqlite
      .prepare('UPDATE sync_staff_channel SET export_seq = ? WHERE employee_id = ?')
      .run(before, ids.employee.id)
    as(admin, () =>
      admin.db
        .update(schema.deal_memo)
        .set({ notes: 'nach der Sicherung' })
        .where(eq(schema.deal_memo.id, ids.sharedEvent))
        .run()
    )
    await runChannel(env(admin), ids.employee)
    expect(getChannel(admin.sqlite, ids.employee.id)!.export_seq).toBeGreaterThan(before + 1)
    await run(staff)
    expect(
      (
        staff.sqlite.prepare('SELECT notes FROM deal_memo WHERE id = ?').get(ids.sharedEvent) as {
          notes: string
        }
      ).notes
    ).toBe('nach der Sicherung')
  })

  it('marks the folder when the access is taken away', async () => {
    const { admin, ids } = await setUpAdmin()
    await createChannel(env(admin), ids.employee, staffFolder)
    expect(await new FolderTransport(staffFolder).readRevocation()).toBeNull()
    await revokeChannel(env(admin), ids.employee.id)
    expect(await new FolderTransport(staffFolder).readRevocation()).not.toBeNull()
    expect(getChannel(admin.sqlite, ids.employee.id)).toBeNull()
  })
})
