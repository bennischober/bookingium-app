// ========================================
// What an employee sees and may change (#262)
// ========================================
// Pure rules over the admin computer's database. The bridge (bridge.ts) writes exactly the view
// computed here into the employee's folder and checks every change coming back against it.
//
// Decided with the user:
// - Contacts (bands, persons, companies, clubs, festivals, hotels, mailing lists) only go when
//   shared with the employee (one by one, or from an uploaded contact list), or when a visible
//   record needs them: the club, promoter and hotel of a visible event, the company of a visible
//   band, the members of a visible band, company or club, the records of a shared mailing list.
//   A contact marked internal never goes, not even linked.
// - A band shared with the employee passes on its booking work: the events (with the contract
//   that is printed from them), their itinerary, advancing and tickets, agency bookings,
//   marketing. Money and management do not inherit: invoices, settlements (Abrechnungen),
//   management contracts, receipts and travel expenses need a grant of their own.
// - Documents filed at a visible event inherit, except invoices and settlements as files;
//   any record can be marked internal.
// - What the employee created is always theirs to see (its id is in their range).
// - Shared records may be changed, only own ones deleted. Invoices stay drafts.
//
// A table without a rule here is never sent: tests/staff_policy.test.ts fails for a new table
// until it gets one.
import { idRange } from '../sync/ids'
import { isLocalSettingKey, STORAGE_PATH_COLUMNS } from '../sync/tables'
import {
  foreignKeys,
  keyColumn,
  quoteIdent as q,
  syncedTables,
  tableColumns,
  type ColumnInfo,
  type ForeignKey,
  type Sqlite
} from '../sync/store'
import type { RowChange } from '../sync/format'
import type { StaffGrantAccess, StaffGrantEntity } from '../api/schemas/staff.schema'

export type Row = Record<string, unknown>
/** table -> row key (as text) -> the row as the employee gets it */
export type StaffView = Map<string, Map<string, Row>>

export type StaffContext = { employeeId: number; idPrefix: number }

type Grants = Map<string, StaffGrantAccess>

/** What the rules can look up while deciding a row */
type Lookup = {
  own: (id: unknown) => boolean
  access: (entity: StaffGrantEntity, id: unknown) => StaffGrantAccess | null
  /** Whether a row of a table is in the view (tables decided earlier) */
  has: (table: string, id: unknown) => boolean
  /** The band is shared with the employee (its booking work is visible) */
  bandShared: (id: unknown) => boolean
}

type Rule =
  /** every row */
  | { kind: 'all' }
  /** never sent, never taken back */
  | { kind: 'never' }
  /** a record that can be granted; `inherit` decides it without a grant */
  | { kind: 'grant'; entity: StaffGrantEntity; inherit?: (row: Row, l: Lookup) => boolean }
  /** visible with its parent row */
  | { kind: 'child'; parent: string; column: string }
  | { kind: 'custom'; visible: (row: Row, l: Lookup) => boolean }
  /** a contact: own or shared, or needed by a visible record (decided after the others) */
  | { kind: 'contact'; entity: StaffGrantEntity }
  /** the members of a contact (band, company, club, mailing list): they go with it */
  | { kind: 'member'; parent: string; column: string }
  /** address, phone/mail, bank account: visible when a visible row refers to it */
  | { kind: 'linked' }

/** Document types that never come with a visible event (an invoice or settlement as PDF) */
const MONEY_DOCUMENTS: ReadonlySet<string> = new Set(['invoice', 'deposit', 'settlement'])

const child = (parent: string, column: string): Rule => ({ kind: 'child', parent, column })
const bandWork: Rule = {
  kind: 'custom',
  visible: (row, l) => l.own(row.id) || l.bandShared(row.band_id)
}
/** follow-ups and appointments: own, or at a visible event, a shared band or a visible invoice */
const attached: Rule = {
  kind: 'custom',
  visible: (row, l) =>
    l.own(row.id) ||
    (row.event_id != null && l.has('deal_memo', row.event_id)) ||
    (row.invoice_id != null && l.has('invoice', row.invoice_id)) ||
    (row.band_id != null && l.bandShared(row.band_id))
}

/**
 * The rule of every synced table, in the order they are decided: a rule may only look at
 * tables above it.
 */
export const TABLE_RULES: ReadonlyArray<[string, Rule]> = [
  // contacts: shared or linked (decided after the records that link them)
  ['address', { kind: 'linked' }],
  ['contact', { kind: 'linked' }],
  ['contact_email', child('contact', 'contact_id')],
  ['bank', { kind: 'linked' }],
  ['person', { kind: 'contact', entity: 'person' }],
  ['company', { kind: 'contact', entity: 'company' }],
  ['company_member', { kind: 'member', parent: 'company', column: 'company_id' }],
  ['band', { kind: 'contact', entity: 'band' }],
  ['band_member', { kind: 'member', parent: 'band', column: 'band_id' }],
  ['venue', { kind: 'contact', entity: 'venue' }],
  ['venue_member', { kind: 'member', parent: 'venue', column: 'venue_id' }],
  ['genre', { kind: 'all' }],
  ['venue_genre', child('venue', 'venue_id')],
  ['company_genre', child('company', 'company_id')],
  ['band_genre', child('band', 'band_id')],
  ['hotel', { kind: 'contact', entity: 'hotel' }],
  ['contact_list', { kind: 'contact', entity: 'contact_list' }],
  ['contact_list_member', { kind: 'member', parent: 'contact_list', column: 'contact_list_id' }],
  ['mail_template', { kind: 'all' }],
  ['app_setting', { kind: 'custom', visible: (row) => !isLocalSettingKey(String(row.key)) }],
  // company-internal
  ['company_invoice_settings', { kind: 'never' }],
  ['datev_transfer', { kind: 'never' }],
  ['employee', { kind: 'never' }],
  ['staff_grant', { kind: 'never' }],
  // events: the booking work of a shared band
  [
    'deal_memo',
    { kind: 'grant', entity: 'deal_memo', inherit: (row, l) => l.bandShared(row.band_id) }
  ],
  ['deal_memo_deposit', child('deal_memo', 'deal_memo_id')],
  ['itinerary', child('deal_memo', 'deal_memo_id')],
  ['event_advancing', child('deal_memo', 'deal_memo_id')],
  ['event_step_done', child('deal_memo', 'deal_memo_id')],
  ['event_ticket_quota', child('deal_memo', 'deal_memo_id')],
  ['ticket_report', child('deal_memo', 'deal_memo_id')],
  ['external_booking', bandWork],
  ['marketing_atlas', bandWork],
  ['marketing_item', bandWork],
  // money and management: only with a grant (or own)
  ['invoice', { kind: 'grant', entity: 'invoice' }],
  ['invoice_line_item', child('invoice', 'invoice_id')],
  ['invoice_email', child('invoice', 'invoice_id')],
  ['invoice_status_change', child('invoice', 'invoice_id')],
  [
    'invoice_party_snapshot',
    {
      kind: 'custom',
      // referenced by a visible invoice; invoices are decided above
      visible: () => false
    }
  ],
  ['event_settlement', { kind: 'grant', entity: 'event_settlement' }],
  ['management_contract', { kind: 'grant', entity: 'management_contract' }],
  ['management_contract_member', child('management_contract', 'contract_id')],
  // publishing and label agreements: like management, never inherited; only the employee's own
  ['band_agreement', { kind: 'custom', visible: (row, l) => l.own(row.id) }],
  [
    'management_share',
    {
      kind: 'custom',
      visible: (row, l) =>
        l.has('invoice', row.invoice_id) &&
        (row.management_contract_id == null ||
          l.has('management_contract', row.management_contract_id))
    }
  ],
  ['management_share_income', child('management_share', 'share_id')],
  ['trip', { kind: 'grant', entity: 'trip' }],
  ['receipt', { kind: 'grant', entity: 'receipt' }],
  ['marketing_action', bandWork],
  // documents: filed at a visible event, or granted
  [
    'document',
    {
      kind: 'grant',
      entity: 'document',
      // invoices and settlements filed at an event are money: they need a grant of their own
      inherit: (row, l) =>
        row.owner_type === 'event' &&
        !MONEY_DOCUMENTS.has(String(row.document_type)) &&
        l.has('deal_memo', row.owner_id)
    }
  ],
  ['document_link', child('document', 'document_id')],
  ['follow_up', attached],
  ['appointment', attached]
]

const RULES = new Map(TABLE_RULES)

/** The synced tables without a rule (never sent): for the guard test */
export function tablesWithoutRule(sqlite: Sqlite): string[] {
  return syncedTables(sqlite).filter((table) => !RULES.has(table))
}

/** Whether a row key is in the employee's id range: they created it */
export function isOwnKey(ctx: StaffContext, key: unknown): boolean {
  const id = typeof key === 'number' ? key : Number(key)
  if (!Number.isFinite(id)) return false
  const { first, last } = idRange(ctx.idPrefix)
  return id >= first && id <= last
}

function loadGrants(sqlite: Sqlite, employeeId: number): { own: Grants; all: Grants } {
  const rows = sqlite
    .prepare(
      'SELECT employee_id, entity, entity_id, access FROM staff_grant WHERE employee_id IS NULL OR employee_id = ?'
    )
    .all(employeeId) as Array<{
    employee_id: number | null
    entity: string
    entity_id: number
    access: StaffGrantAccess
  }>
  const own: Grants = new Map()
  const all: Grants = new Map()
  for (const row of rows) {
    ;(row.employee_id === null ? all : own).set(`${row.entity}:${row.entity_id}`, row.access)
  }
  return { own, all }
}

/** The employee's own grant wins over one for everybody */
function grantAccess(
  grants: { own: Grants; all: Grants },
  entity: StaffGrantEntity,
  id: unknown
): StaffGrantAccess | null {
  const key = `${entity}:${String(id)}`
  return grants.own.get(key) ?? grants.all.get(key) ?? null
}

type TableFacts = { key: string; columns: ColumnInfo[]; fks: ForeignKey[] }

function facts(sqlite: Sqlite, table: string): TableFacts {
  return {
    key: keyColumn(table),
    columns: tableColumns(sqlite, table),
    fks: foreignKeys(sqlite, table)
  }
}

/** Tables decided after the closure over contacts (they depend on which contacts go) */
function deferredTables(): Set<string> {
  const deferred = new Set<string>()
  for (const [table, rule] of TABLE_RULES) {
    if (
      rule.kind === 'contact' ||
      rule.kind === 'member' ||
      rule.kind === 'linked' ||
      (rule.kind === 'child' && deferred.has(rule.parent))
    )
      deferred.add(table)
  }
  return deferred
}
const DEFERRED = deferredTables()

type MemberRule = Extract<Rule, { kind: 'member' }>

/**
 * Everything the employee gets, as rows. Decided in three steps:
 * 1. the records with rules of their own (events, invoices, documents …) in TABLE_RULES order;
 *    of the contacts only the own and shared ones;
 * 2. the contacts the visible rows need (repeated: a club brings its promoter), with the members
 *    of every visible band, company, club and mailing list;
 * 3. addresses, phone/mail, bank accounts and genres of what is visible.
 * A visible row pointing at a hidden one loses that reference (or, where the column is required,
 * goes hidden too), so the employee's database stays consistent.
 */
export function computeStaffView(sqlite: Sqlite, ctx: StaffContext): StaffView {
  const synced = new Set(syncedTables(sqlite))
  const grants = loadGrants(sqlite, ctx.employeeId)
  const view: StaffView = new Map()
  const tableFacts = new Map<string, TableFacts>()

  const lookup: Lookup = {
    own: (id) => isOwnKey(ctx, id),
    access: (entity, id) => grantAccess(grants, entity, id),
    has: (table, id) => id != null && (view.get(table)?.has(String(id)) ?? false),
    bandShared: (id) => id != null && grantAccess(grants, 'band', id) === 'shared'
  }

  const allRows = new Map<string, Row[]>()
  const rowsOf = (table: string): Row[] => {
    let rows = allRows.get(table)
    if (!rows) {
      rows = sqlite.prepare(`SELECT * FROM ${q(table)}`).all() as Row[]
      allRows.set(table, rows)
    }
    return rows
  }

  /** A grantable record: true for own or shared, false for internal, null without a grant */
  const granted = (entity: StaffGrantEntity, id: unknown): boolean | null => {
    if (lookup.own(id)) return true
    const access = lookup.access(entity, id)
    return access === 'shared' ? true : access === 'internal' ? false : null
  }

  // ---- 1. records with rules of their own; the own and shared contacts ----
  // contact table -> all its rows by key, to bring them in later
  const contactPool = new Map<string, Map<string, Row>>()
  const contactEntity = new Map<string, StaffGrantEntity>()
  for (const [table, rule] of TABLE_RULES) {
    if (!synced.has(table)) continue
    const f = facts(sqlite, table)
    tableFacts.set(table, f)
    const rows = view.set(table, new Map()).get(table)!
    if (rule.kind === 'never') continue
    if (rule.kind === 'contact') {
      const pool = new Map<string, Row>()
      contactPool.set(table, pool)
      contactEntity.set(table, rule.entity)
      for (const row of rowsOf(table)) {
        pool.set(String(row[f.key]), row)
        if (granted(rule.entity, row[f.key]) === true) rows.set(String(row[f.key]), row)
      }
      continue
    }
    if (DEFERRED.has(table)) continue
    for (const row of rowsOf(table)) {
      let visible = false
      switch (rule.kind) {
        case 'all':
          visible = true
          break
        case 'child':
          visible = lookup.has(rule.parent, row[rule.column])
          break
        case 'custom':
          visible = rule.visible(row, lookup)
          break
        case 'grant':
          visible = granted(rule.entity, row[f.key]) ?? !!rule.inherit?.(row, lookup)
          break
      }
      if (visible) rows.set(String(row[f.key]), row)
    }
  }

  // ---- 2. the contacts visible rows need, with the members of visible contacts ----
  const members = new Map<string, Array<[string, MemberRule]>>()
  for (const [table, rule] of TABLE_RULES) {
    if (rule.kind !== 'member' || !synced.has(table)) continue
    const list = members.get(rule.parent) ?? []
    list.push([table, rule])
    members.set(rule.parent, list)
  }
  /** A contact the employee may get: it exists and is not internal for them */
  const allowed = (table: string, id: string): boolean =>
    contactPool.get(table)?.has(id) === true && granted(contactEntity.get(table)!, id) !== false

  const queue: Array<[string, Row]> = []
  for (const [table, rows] of view) for (const row of rows.values()) queue.push([table, row])
  const bringIn = (table: string, id: string): void => {
    const rows = view.get(table)!
    if (rows.has(id) || !allowed(table, id)) return
    const row = contactPool.get(table)!.get(id)!
    rows.set(id, row)
    queue.push([table, row])
  }
  const done = new Set<string>()
  while (queue.length > 0) {
    const [table, row] = queue.pop()!
    const f = tableFacts.get(table)
    if (!f) continue
    const mark = `${table}:${String(row[f.key])}`
    if (done.has(mark)) continue
    done.add(mark)
    for (const fk of f.fks) {
      const value = row[fk.from]
      if (value != null && contactPool.has(fk.table)) bringIn(fk.table, String(value))
    }
    // the members go with a visible contact, unless a contact they name is internal
    for (const [memberTable, rule] of members.get(table) ?? []) {
      const mf = tableFacts.get(memberTable)!
      const visibleMembers = view.get(memberTable)!
      for (const member of rowsOf(memberTable)) {
        if (String(member[rule.column]) !== String(row[f.key])) continue
        const named = mf.fks.filter(
          (fk) => fk.from !== rule.column && member[fk.from] != null && contactPool.has(fk.table)
        )
        if (named.some((fk) => !allowed(fk.table, String(member[fk.from])))) continue
        visibleMembers.set(String(member[mf.key]), member)
        queue.push([memberTable, member])
      }
    }
  }

  // ---- 3. addresses, phone/mail, bank accounts and genres of what is visible ----
  for (const [table, rule] of TABLE_RULES) {
    if (!synced.has(table) || !DEFERRED.has(table)) continue
    if (rule.kind !== 'linked' && rule.kind !== 'child') continue
    const f = tableFacts.get(table)!
    const rows = view.get(table)!
    const wanted = new Set<string>()
    if (rule.kind === 'linked') {
      for (const [other, otherRows] of view) {
        for (const fk of tableFacts.get(other)?.fks ?? []) {
          if (fk.table !== table) continue
          for (const row of otherRows.values())
            if (row[fk.from] != null) wanted.add(String(row[fk.from]))
        }
      }
    }
    for (const row of rowsOf(table)) {
      const pk = String(row[f.key])
      const visible =
        rule.kind === 'linked'
          ? wanted.has(pk) || lookup.own(row[f.key])
          : lookup.has(rule.parent, row[rule.column])
      if (visible) rows.set(pk, row)
    }
  }

  // the party snapshots the visible invoices print
  const snapshots = view.get('invoice_party_snapshot')
  if (snapshots && synced.has('invoice_party_snapshot')) {
    const wanted = new Set<string>()
    for (const invoice of view.get('invoice')?.values() ?? []) {
      if (invoice.issuer_snapshot_id != null) wanted.add(String(invoice.issuer_snapshot_id))
      if (invoice.recipient_snapshot_id != null) wanted.add(String(invoice.recipient_snapshot_id))
    }
    const key = keyColumn('invoice_party_snapshot')
    for (const row of rowsOf('invoice_party_snapshot')) {
      if (wanted.has(String(row[key])) || isOwnKey(ctx, row[key]))
        snapshots.set(String(row[key]), row)
    }
  }

  redact(view, tableFacts)
  return view
}

/**
 * References to hidden rows: a nullable column is emptied in the employee's copy, a row whose
 * required reference is hidden goes hidden. Repeated until nothing changes (hiding a row can
 * orphan its children).
 */
function redact(view: StaffView, tableFacts: Map<string, TableFacts>): void {
  for (let changed = true; changed; ) {
    changed = false
    for (const [table, rows] of view) {
      const f = tableFacts.get(table)
      if (!f || f.fks.length === 0) continue
      for (const [pk, row] of rows) {
        let copy: Row | null = null
        let drop = false
        for (const fk of f.fks) {
          const value = (copy ?? row)[fk.from]
          if (value === null || value === undefined) continue
          if (view.get(fk.table)?.has(String(value))) continue
          const column = f.columns.find((c) => c.name === fk.from)
          if (column?.notnull === 1) {
            drop = true
            break
          }
          copy = { ...(copy ?? row), [fk.from]: null }
        }
        if (drop) {
          rows.delete(pk)
          changed = true
        } else if (copy) {
          rows.set(pk, copy)
        }
      }
    }
  }
}

/** Storage paths (documents, logos, receipts) the view refers to */
export function viewFiles(view: StaffView): Set<string> {
  const paths = new Set<string>()
  for (const [table, columns] of Object.entries(STORAGE_PATH_COLUMNS)) {
    for (const row of view.get(table)?.values() ?? []) {
      for (const column of columns) {
        const value = row[column]
        if (typeof value === 'string' && value !== '') paths.add(value)
      }
    }
  }
  return paths
}

// ---------- changes coming back ----------

/** Tables an employee may write to at all */
function writable(table: string): boolean {
  const rule = RULES.get(table)
  return rule !== undefined && rule.kind !== 'never' && table !== 'app_setting'
}

const INVOICE_CHILDREN: Readonly<Record<string, string>> = {
  invoice_line_item: 'invoice_id',
  invoice_email: 'invoice_id',
  invoice_status_change: 'invoice_id'
}

export type ChangeCheck = { ok: true; row: RowChange } | { ok: false; reason: string }

/**
 * Whether the bridge takes an employee's change, against the admin database before it is
 * applied. `sent` is the employee's copy of the row as the bridge last sent it (null: never
 * sent). Returns the change to apply, which can be narrower than the incoming one: columns the
 * employee only saw emptied (a hidden reference) are left out, so they are not wiped.
 */
export function checkStaffChange(
  sqlite: Sqlite,
  ctx: StaffContext,
  change: RowChange,
  sent: Row | null
): ChangeCheck {
  const { t: table, k: key, o: op } = change
  if (!writable(table)) return { ok: false, reason: `${table}: nicht freigegeben` }
  const own = keyColumn(table) === 'id' && isOwnKey(ctx, key)

  if (op === 'd') {
    return own ? { ok: true, row: change } : { ok: false, reason: 'Nur eigene Einträge löschen' }
  }
  if (op === 'i' && !own)
    return { ok: false, reason: 'Neuer Eintrag außerhalb des eigenen Bereichs' }
  if (op === 'u' && !own && !sent) return { ok: false, reason: 'Eintrag nicht freigegeben' }

  // the own companies carry bank account and tax data of the invoices (as in staff access)
  if (table === 'company' && !own && isOwnCompany(sqlite, key))
    return { ok: false, reason: 'Die eigene Firma ändert nur ein Admin' }

  const values = { ...(change.c ?? {}) }
  if (!own && sent) {
    // columns emptied in the employee's copy hide a reference: never taken back from there
    const actual = currentRow(sqlite, table, key)
    if (actual) {
      for (const column of Object.keys(values)) {
        if (sent[column] === null && actual[column] !== null && actual[column] !== undefined)
          delete values[column]
      }
    }
  }

  // invoices: drafts only, numbers are given by an admin
  if (table === 'invoice') {
    const actual = currentRow(sqlite, table, key)
    if (actual && actual.status !== 'draft')
      return { ok: false, reason: 'Gestellte Rechnungen ändert nur ein Admin' }
    const status = values.status ?? actual?.status ?? 'draft'
    if (status !== 'draft') return { ok: false, reason: 'Rechnungen stellt nur ein Admin' }
    if (values.invoice_number != null)
      return { ok: false, reason: 'Rechnungsnummern vergibt nur ein Admin' }
  }
  const parentColumn = INVOICE_CHILDREN[table]
  if (parentColumn) {
    const parentId = values[parentColumn] ?? currentRow(sqlite, table, key)?.[parentColumn]
    const parent = parentId == null ? null : currentRow(sqlite, 'invoice', String(parentId))
    if (parent && parent.status !== 'draft')
      return { ok: false, reason: 'Gestellte Rechnungen ändert nur ein Admin' }
  }

  if (op === 'u' && Object.keys(values).length === 0)
    return { ok: false, reason: 'Nichts zu übernehmen' }
  return { ok: true, row: { ...change, c: values } }
}

function isOwnCompany(sqlite: Sqlite, key: string): boolean {
  return !!sqlite
    .prepare(
      'SELECT 1 FROM company WHERE id = ? AND (is_default_for_invoicing = 1 OR EXISTS (SELECT 1 FROM company_invoice_settings s WHERE s.company_id = company.id))'
    )
    .get(Number(key))
}

function currentRow(sqlite: Sqlite, table: string, key: string): Row | null {
  const column = keyColumn(table)
  return (
    (sqlite
      .prepare(`SELECT * FROM ${q(table)} WHERE ${q(column)} = ?`)
      .get(column === 'id' ? Number(key) : key) as Row | undefined) ?? null
  )
}

/** Tables in an order where every table comes after the ones it references */
export function parentFirstOrder(sqlite: Sqlite, tables: string[]): string[] {
  const set = new Set(tables)
  const done = new Set<string>()
  const order: string[] = []
  const visit = (table: string, path: Set<string>) => {
    if (done.has(table) || path.has(table)) return
    path.add(table)
    for (const fk of foreignKeys(sqlite, table)) if (set.has(fk.table)) visit(fk.table, path)
    path.delete(table)
    done.add(table)
    order.push(table)
  }
  for (const table of tables) visit(table, new Set())
  return order
}
