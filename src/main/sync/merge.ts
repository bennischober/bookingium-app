// ========================================
// Joining: the joining computer's own data merged into the group's
// ========================================
// The joiner starts from the group's starting point (another computer's full data) and adds its
// own rows to it, so nothing either computer had is lost and nothing is there twice:
// - A row that is the same thing as one already there (the same person, band, event, invoice
//   number...) is matched by its natural key (keyOf) and merged field by field: an empty field
//   takes the joiner's value; when the joiner edited the record more recently, its values win.
//   A row with the same id and the same created_at is the same row too (both computers once
//   started from one backup).
// - Every other row is inserted under a new id of the joiner's range; the foreign keys of later
//   rows follow the mapping.
// Addresses, contact data, bank accounts and invoice party snapshots belong to one record each,
// so they are never matched on their own: they follow their owner.
// The writes happen with the change triggers on, so they become the joiner's first batch and
// reach the other computers like any edit.
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, extname } from 'path'
import { nextRowId } from './ids'
import { listStorageFiles, sha256File, storagePath } from './storageFiles'
import {
  DOCUMENT_OWNER_TABLES,
  LOCAL_TABLES,
  STORAGE_PATH_COLUMNS,
  isLocalSettingKey
} from './tables'
import { SchemaInfo, keyColumn, quoteIdent as q, whileApplying, type Sqlite } from './store'

type Row = Record<string, unknown>

/** Tables in the order they are merged: every table after the ones its foreign keys point to */
export const MERGE_ORDER: readonly string[] = [
  'genre',
  'person',
  'company',
  'band',
  'venue',
  'hotel',
  'contact_email',
  'company_member',
  'band_member',
  'venue_member',
  'venue_genre',
  'company_genre',
  'band_genre',
  'deal_memo',
  'deal_memo_deposit',
  'itinerary',
  'company_invoice_settings',
  'invoice',
  'invoice_line_item',
  'invoice_email',
  // #225: trips, then received documents (a receipt may belong to a trip); datev_transfer
  // points to receipts as well as to invoices
  'trip',
  'receipt',
  'datev_transfer',
  'invoice_status_change',
  'management_contract',
  'management_contract_member',
  'management_share',
  'management_share_income',
  // publishing and label agreements of a band
  'band_agreement',
  // #228: one per event; its fee invoice is merged before it
  'event_settlement',
  // #232: advancing, ticket quota and sales reports of a show
  'event_advancing',
  'event_ticket_quota',
  'ticket_report',
  // steps of a show done outside the program ("extern erledigt")
  'event_step_done',
  // Marketing-Atlas of a band; items name a company or venue
  'marketing_atlas',
  'marketing_item',
  'marketing_action',
  'document',
  // further records a document belongs to; after the document and every record it names
  'document_link',
  'contact_list',
  'contact_list_member',
  'follow_up',
  'appointment',
  'external_booking',
  'mail_template',
  'app_setting',
  // #262: employees and what is shared with them
  'employee',
  'staff_grant'
]

/** Rows that belong to one owner record, by the owner's column */
export const OWNED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  person: ['address_id', 'contact_id'],
  company: ['address_id', 'contact_id', 'bank_id'],
  venue: ['address_id', 'contact_id'],
  hotel: ['address_id', 'contact_id'],
  invoice: ['issuer_snapshot_id', 'recipient_snapshot_id']
}
export const OWNED_TABLES: ReadonlySet<string> = new Set([
  'address',
  'contact',
  'bank',
  'invoice_party_snapshot'
])

/** mail_link.entity_type and mail_rule.link_entity_type -> table */
const LINK_ENTITY_TABLES: Readonly<Record<string, string>> = {
  person: 'person',
  company: 'company',
  band: 'band',
  venue: 'venue',
  event: 'deal_memo',
  invoice: 'invoice',
  contract: 'management_contract'
}

/** Text for matching: case, accents, umlaut spellings, punctuation and spacing do not matter */
export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const n = normalizeText
const v = (value: unknown) => (value === null || value === undefined ? '' : String(value))
const isEmpty = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

/** The natural key a row is matched by; null when it has none (then it is never matched) */
export function keyOf(table: string, row: Row): string | null {
  const key = (...parts: unknown[]) => parts.map(v).join('|')
  switch (table) {
    case 'genre':
    case 'band':
    case 'company':
    case 'venue':
    case 'hotel':
    case 'contact_list':
      return n(row.name) || null
    case 'person': {
      const name = `${n(row.first_name)}|${n(row.last_name)}`
      return name === '|' ? null : name
    }
    case 'contact_email':
      return key(
        row.contact_id,
        String(row.email ?? '')
          .trim()
          .toLowerCase()
      )
    case 'company_member':
      return key(row.company_id, row.person_id)
    case 'band_member':
      return key(row.band_id, row.person_id)
    case 'venue_member':
      return key(row.venue_id, row.person_id)
    case 'venue_genre':
      return key(row.venue_id, row.genre_id)
    case 'company_genre':
      return key(row.company_id, row.genre_id)
    case 'band_genre':
      return key(row.band_id, row.genre_id)
    case 'deal_memo':
      return key(row.band_id, row.date)
    case 'deal_memo_deposit':
      return key(row.deal_memo_id, row.position)
    case 'itinerary':
      return key(row.deal_memo_id)
    case 'event_step_done':
      return key(row.deal_memo_id, row.step)
    case 'company_invoice_settings':
      return key(row.company_id)
    case 'invoice':
      return row.invoice_number !== null && row.invoice_number !== undefined
        ? key(row.company_id, 'nr', row.invoice_number)
        : key(
            row.company_id,
            'draft',
            row.deal_memo_id,
            row.kind,
            row.issue_date,
            row.total_gross_cents
          )
    case 'invoice_line_item':
      return key(row.invoice_id, row.position)
    case 'invoice_email':
      return key(row.invoice_id, row.kind, row.created_at)
    case 'invoice_status_change':
      return key(row.invoice_id, row.status, row.created_at)
    case 'datev_transfer':
      // the send key is unique per upload
      return key(row.send_key)
    case 'employee':
      return key(row.id_prefix)
    case 'staff_grant':
      return key(row.employee_id, row.entity, row.entity_id)
    case 'management_contract':
      return key(row.band_id, row.start_date)
    case 'band_agreement':
      return key(row.band_id, row.kind, row.start_date, row.created_at)
    case 'management_contract_member':
      return key(row.contract_id, row.person_id)
    case 'management_share':
      return key(row.invoice_id)
    case 'management_share_income':
      return key(row.share_id, row.position)
    case 'document':
      return key(row.owner_type, row.owner_id, n(row.file_name), row.file_size)
    case 'contact_list_member':
      return key(row.contact_list_id, row.person_id, row.company_id, row.venue_id)
    case 'document_link':
      return key(
        row.document_id,
        row.deal_memo_id,
        row.band_id,
        row.company_id,
        row.venue_id,
        row.person_id
      )
    case 'follow_up':
      return key(
        row.due_date,
        n(row.note),
        row.event_id,
        row.band_id,
        row.venue_id,
        row.company_id,
        row.person_id,
        row.invoice_id
      )
    case 'appointment':
      return row.ical_uid
        ? key('uid', row.ical_uid)
        : key(n(row.title), row.start_date, row.start_time)
    case 'external_booking':
      return key(row.agency, row.source_key)
    case 'mail_template':
      return row.kind ? key(row.kind, row.lang) : key('name', n(row.name))
    case 'app_setting':
      return v(row.key)
    default:
      return null
  }
}

export type MergeStats = Record<string, { matched: number; inserted: number; skipped: number }>

export type MergeOptions = {
  /** The group's data, with this computer's identity, triggers and ids already set up */
  target: Sqlite
  /** A consistent copy of this computer's own database */
  localFile: string
  /** This computer's storage/ */
  localStorage: string
  /** The storage/ that goes with `target` */
  targetStorage: string
}

/** Merges the local data into the target; see the file header */
export async function mergeLocalData(options: MergeOptions): Promise<MergeStats> {
  const pathMap = await copyStorage(options.localStorage, options.targetStorage)
  const { target } = options
  target.prepare('ATTACH DATABASE ? AS loc').run(options.localFile)
  try {
    const merger = new Merger(target, pathMap)
    target.transaction(() => {
      merger.mergeAll()
      merger.carryLocalData()
    })()
    return merger.stats
  } finally {
    target.exec('DETACH DATABASE loc')
  }
}

/**
 * Copies the local storage files into the target storage. A file whose path is taken by a
 * different file gets a new name; the returned map (old path -> new path) is applied to the
 * path columns of the local rows.
 */
async function copyStorage(localRoot: string, targetRoot: string): Promise<Map<string, string>> {
  const pathMap = new Map<string, string>()
  if (!existsSync(localRoot)) return pathMap
  for (const path of await listStorageFiles(localRoot)) {
    const source = storagePath(localRoot, path)
    let destination = storagePath(targetRoot, path)
    if (!source || !destination) continue
    let finalPath = path
    if (existsSync(destination)) {
      if ((await sha256File(source)) === (await sha256File(destination))) continue
      const extension = extname(path)
      const stem = path.slice(0, path.length - extension.length)
      for (let i = 2; existsSync(destination); i++) {
        finalPath = `${stem}-${i}${extension}`
        destination = storagePath(targetRoot, finalPath) as string
      }
      pathMap.set(path, finalPath)
    }
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
  }
  return pathMap
}

class Merger {
  readonly stats: MergeStats = {}
  private schema: SchemaInfo
  private localTables: Set<string>
  /** table -> local id -> target id */
  private map = new Map<string, Map<string, string>>()
  /** Target rows by natural key, built per table from the rows there before the merge */
  private index = new Map<string, Map<string, Row[]>>()
  private hasDefaultCompany: boolean

  constructor(
    private db: Sqlite,
    private pathMap: Map<string, string>
  ) {
    this.schema = new SchemaInfo(db)
    this.localTables = new Set(
      (
        db.prepare("SELECT name FROM loc.sqlite_master WHERE type = 'table'").all() as Array<{
          name: string
        }>
      ).map((r) => r.name)
    )
    this.hasDefaultCompany = !!db
      .prepare('SELECT 1 FROM main.company WHERE is_default_for_invoicing = 1')
      .get()
  }

  mergeAll(): void {
    for (const table of MERGE_ORDER) {
      if (!this.schema.has(table) || !this.localTables.has(table)) continue
      this.stats[table] = { matched: 0, inserted: 0, skipped: 0 }
      this.buildIndex(table)
      const key = keyColumn(table)
      for (const row of this.localRows(table)) this.mergeRow(table, key, row)
      if (table === 'invoice') this.fixSelfReferences(table, 'cancels_invoice_id')
    }
  }

  // ---------- one row ----------

  private mergeRow(table: string, key: string, local: Row): void {
    const stat = this.stats[table]
    if (table === 'app_setting' && isLocalSettingKey(String(local.key))) return
    const remapped = this.remap(table, local)
    if (!remapped) {
      stat.skipped++
      return
    }
    const match = this.findMatch(table, local, remapped)
    if (match) {
      this.mapId(table, local[key], match[key])
      const preferLocal =
        typeof local.updated_at === 'string' &&
        typeof match.updated_at === 'string' &&
        local.updated_at > match.updated_at
      const owned = this.mergeOwned(table, local, match, preferLocal)
      this.mergeFields(table, match, { ...remapped, ...owned }, preferLocal)
      stat.matched++
      return
    }
    const owned = this.mergeOwned(table, local, null, true)
    const record: Row = { ...remapped, ...owned }
    if (table === 'company' && record.is_default_for_invoicing) {
      if (this.hasDefaultCompany) record.is_default_for_invoicing = 0
      else this.hasDefaultCompany = true
    }
    if (key === 'id') record.id = nextRowId()
    if (key === 'id' && (record.id === null || record.id === undefined))
      throw new Error('Row ids are not configured for the merge')
    if (this.insert(table, record)) {
      this.mapId(table, local[key], record[key])
      stat.inserted++
    } else {
      stat.skipped++
    }
  }

  /**
   * The local row with its foreign keys (and storage paths, document owners) pointing into the
   * target; null when a required parent did not make it. Owned columns stay as they are here.
   */
  private remap(table: string, local: Row): Row | null {
    const known = this.schema.columnNames(table)
    const row: Row = {}
    for (const [column, value] of Object.entries(local)) if (known.has(column)) row[column] = value
    delete row[keyColumn(table)]
    const owned = new Set(OWNED_COLUMNS[table] ?? [])
    for (const fk of this.schema.foreignKeysOf(table)) {
      if (owned.has(fk.from)) continue
      const value = row[fk.from]
      if (value === null || value === undefined) continue
      // set afterwards, once the referenced row of the same table has its id
      if (fk.table === table) {
        row[fk.from] = null
        continue
      }
      const mapped = this.mapped(fk.table, value)
      if (mapped !== undefined) row[fk.from] = Number(mapped)
      else if (this.notNull(table, fk.from)) return null
      else row[fk.from] = null
    }
    if (table === 'document') {
      const ownerTable = DOCUMENT_OWNER_TABLES[String(row.owner_type)]
      const owner = ownerTable ? this.mapped(ownerTable, row.owner_id) : undefined
      if (owner === undefined) return null
      row.owner_id = Number(owner)
    }
    for (const column of STORAGE_PATH_COLUMNS[table] ?? []) {
      const path = row[column]
      if (typeof path === 'string' && this.pathMap.has(path)) row[column] = this.pathMap.get(path)
    }
    for (const column of owned) delete row[column]
    return row
  }

  private findMatch(table: string, local: Row, remapped: Row): Row | null {
    const key = keyColumn(table)
    // the same row from a common past: same id, same creation time
    if (key === 'id' && local.created_at !== undefined) {
      const same = this.db
        .prepare(`SELECT * FROM main.${q(table)} WHERE id = ? AND created_at IS ?`)
        .get(local.id, local.created_at) as Row | undefined
      if (same && this.compatible(table, local, same)) return same
    }
    const naturalKey = keyOf(table, remapped)
    if (naturalKey === null) return null
    const candidates = (this.index.get(table)?.get(naturalKey) ?? []).filter((target) =>
      this.compatible(table, local, target)
    )
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) return this.refine(table, local, candidates)
    return null
  }

  /** False when the rows share their key but clearly are two different things */
  private compatible(table: string, local: Row, target: Row): boolean {
    const differs = (a: unknown, b: unknown) => !isEmpty(a) && !isEmpty(b) && n(a) !== n(b)
    switch (table) {
      case 'person':
        return !differs(local.birthday, target.birthday)
      case 'company':
        return (
          !differs(local.vat_id, target.vat_id) && !differs(local.tax_number, target.tax_number)
        )
      case 'venue':
      case 'hotel':
        return !differs(this.localCity(local), this.targetCity(target))
      case 'deal_memo': {
        const venue = local.venue_id === null ? null : this.mapped('venue', local.venue_id)
        return (
          local.venue_id === null || target.venue_id === null || String(target.venue_id) === venue
        )
      }
      default:
        return true
    }
  }

  /** Several target rows share the key: the one with the same e-mail, city or VAT id, if exactly one */
  private refine(table: string, local: Row, candidates: Row[]): Row | null {
    let pick: (row: Row) => string = () => ''
    let wanted = ''
    if (table === 'person' || table === 'company' || table === 'venue' || table === 'hotel') {
      wanted = n(this.localEmail(local))
      pick = (row) => n(this.targetEmail(row))
    }
    if (wanted) {
      const byEmail = candidates.filter((row) => pick(row) === wanted)
      if (byEmail.length === 1) return byEmail[0]
    }
    if (table === 'venue' || table === 'hotel') {
      const city = n(this.localCity(local))
      const byCity = candidates.filter((row) => n(this.targetCity(row)) === city)
      if (city && byCity.length === 1) return byCity[0]
    }
    return null
  }

  // ---------- owned rows ----------

  /** Merges or copies the address, contact, bank account or party snapshots of a record */
  private mergeOwned(table: string, local: Row, match: Row | null, preferLocal: boolean): Row {
    const result: Row = {}
    for (const column of OWNED_COLUMNS[table] ?? []) {
      const fk = this.schema.foreignKeysOf(table).find((f) => f.from === column)
      if (!fk) continue
      const localId = local[column]
      if (localId === null || localId === undefined) continue
      const already = this.mapped(fk.table, localId)
      if (already !== undefined) {
        if (!match || match[column] === null) result[column] = Number(already)
        continue
      }
      const ownedRow = this.db
        .prepare(`SELECT * FROM loc.${q(fk.table)} WHERE id = ?`)
        .get(localId) as Row | undefined
      if (!ownedRow) continue
      const remapped = this.remap(fk.table, ownedRow)
      if (!remapped) continue
      const targetId = match?.[column]
      if (targetId !== null && targetId !== undefined) {
        const targetRow = this.db
          .prepare(`SELECT * FROM main.${q(fk.table)} WHERE id = ?`)
          .get(targetId) as Row | undefined
        if (targetRow) {
          this.mergeFields(fk.table, targetRow, remapped, preferLocal)
          this.mapId(fk.table, localId, targetId)
          continue
        }
      }
      const id = nextRowId()
      if (this.insert(fk.table, { ...remapped, id })) {
        this.mapId(fk.table, localId, id)
        result[column] = id
      }
    }
    return result
  }

  // ---------- writes ----------

  /**
   * Fills the target row's empty fields from the local row; with `preferLocal` (the local one was
   * edited more recently) the local values win. A value is never emptied by the merge.
   */
  private mergeFields(table: string, target: Row, local: Row, preferLocal: boolean): void {
    const key = keyColumn(table)
    const changes: Row = {}
    for (const [column, value] of Object.entries(local)) {
      if (column === key || column === 'created_at' || isEmpty(value)) continue
      if (!(column in target)) continue
      const current = target[column]
      if (current === value || String(current) === String(value)) continue
      if (table === 'company' && column === 'is_default_for_invoicing') {
        if (value && !this.hasDefaultCompany) {
          changes[column] = value
          this.hasDefaultCompany = true
        }
        continue
      }
      if (table === 'company_invoice_settings' && column === 'next_invoice_number') {
        if (Number(value) > Number(current)) changes[column] = value
        continue
      }
      if (column === 'updated_at') {
        if (String(value) > String(current)) changes[column] = value
        continue
      }
      if (isEmpty(current) || preferLocal) changes[column] = value
    }
    const columns = Object.keys(changes)
    if (columns.length === 0) return
    try {
      this.db
        .prepare(
          `UPDATE main.${q(table)} SET ${columns.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${q(key)} = ?`
        )
        .run(...columns.map((c) => changes[c]), target[key])
      Object.assign(target, changes)
    } catch (error) {
      // a merged value that clashes with a unique key elsewhere stays as it was
      if (!String((error as { code?: string }).code ?? '').startsWith('SQLITE_CONSTRAINT'))
        throw error
    }
  }

  private insert(table: string, record: Row): boolean {
    const columns = Object.keys(record).filter((c) => record[c] !== undefined)
    try {
      this.db
        .prepare(
          `INSERT INTO main.${q(table)} (${columns.map(q).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
        )
        .run(...columns.map((c) => record[c]))
      return true
    } catch (error) {
      if (String((error as { code?: string }).code ?? '').startsWith('SQLITE_CONSTRAINT'))
        return false
      throw error
    }
  }

  private fixSelfReferences(table: string, column: string): void {
    const rows = this.db
      .prepare(`SELECT id, ${q(column)} AS ref FROM loc.${q(table)} WHERE ${q(column)} IS NOT NULL`)
      .all() as Array<{ id: number; ref: number }>
    for (const row of rows) {
      const id = this.mapped(table, row.id)
      const ref = this.mapped(table, row.ref)
      if (id === undefined || ref === undefined) continue
      this.db
        .prepare(
          `UPDATE main.${q(table)} SET ${q(column)} = ? WHERE id = ? AND ${q(column)} IS NULL`
        )
        .run(Number(ref), Number(id))
    }
  }

  /**
   * The target came with the other computer's local data (its mail links and rules, its calendar
   * file path...). Those are replaced by this computer's own, pointed at the merged ids; the
   * triggers stay silent, as none of it is shared.
   */
  carryLocalData(): void {
    whileApplying(this.db, () => {
      // local settings: this computer's, never the other's
      const settings = this.db.prepare('SELECT key FROM main.app_setting').all() as Array<{
        key: string
      }>
      for (const { key } of settings)
        if (isLocalSettingKey(key))
          this.db.prepare('DELETE FROM main.app_setting WHERE key = ?').run(key)
      if (this.localTables.has('app_setting')) {
        for (const row of this.db.prepare('SELECT * FROM loc.app_setting').all() as Row[]) {
          if (isLocalSettingKey(String(row.key))) this.insert('app_setting', row)
        }
      }
      // local tables: children first out, parents first in
      for (const table of ['mail_rule_hit', 'mail_link', 'invoice_email_pending', 'mail_rule']) {
        if (this.tableExists(table)) this.db.exec(`DELETE FROM main.${q(table)}`)
      }
      for (const table of ['mail_rule', 'mail_rule_hit', 'mail_link', 'invoice_email_pending']) {
        if (!LOCAL_TABLES.has(table) || !this.tableExists(table) || !this.localTables.has(table))
          continue
        for (const row of this.db.prepare(`SELECT * FROM loc.${q(table)}`).all() as Row[]) {
          const record = this.remapLocalRow(table, row)
          if (record) this.insert(table, record)
        }
      }
    })
  }

  private remapLocalRow(table: string, row: Row): Row | null {
    const known = this.schema.columnNames(table)
    const record: Row = Object.fromEntries(Object.entries(row).filter(([c]) => known.has(c)))
    const entity = (typeColumn: string, idColumn: string, required: boolean) => {
      if (record[idColumn] === null || record[idColumn] === undefined) return true
      const entityTable = LINK_ENTITY_TABLES[String(record[typeColumn])]
      const mapped = entityTable ? this.mapped(entityTable, record[idColumn]) : undefined
      if (mapped === undefined) {
        if (required) return false
        record[typeColumn] = null
        record[idColumn] = null
        return true
      }
      record[idColumn] = Number(mapped)
      return true
    }
    if (table === 'mail_link') return entity('entity_type', 'entity_id', true) ? record : null
    if (table === 'mail_rule')
      return entity('link_entity_type', 'link_entity_id', false) ? record : null
    if (table === 'invoice_email_pending') {
      const invoice = this.mapped('invoice', record.invoice_id)
      if (invoice === undefined) return null
      record.invoice_id = Number(invoice)
    }
    return record
  }

  // ---------- lookups ----------

  private localRows(table: string): Row[] {
    return this.db.prepare(`SELECT * FROM loc.${q(table)} ORDER BY rowid`).all() as Row[]
  }

  private buildIndex(table: string): void {
    const byKey = new Map<string, Row[]>()
    for (const row of this.db.prepare(`SELECT * FROM main.${q(table)}`).all() as Row[]) {
      const naturalKey = keyOf(table, row)
      if (naturalKey === null) continue
      const list = byKey.get(naturalKey)
      if (list) list.push(row)
      else byKey.set(naturalKey, [row])
    }
    this.index.set(table, byKey)
  }

  private mapId(table: string, localId: unknown, targetId: unknown): void {
    let byTable = this.map.get(table)
    if (!byTable) {
      byTable = new Map()
      this.map.set(table, byTable)
    }
    byTable.set(String(localId), String(targetId))
  }

  private mapped(table: string, localId: unknown): string | undefined {
    return this.map.get(table)?.get(String(localId))
  }

  private notNull(table: string, column: string): boolean {
    return this.schema.columnsOf(table).some((c) => c.name === column && c.notnull === 1)
  }

  private tableExists(table: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  }

  private localCity(row: Row): string {
    if (row.address_id === null || row.address_id === undefined) return ''
    const found = this.db
      .prepare('SELECT city FROM loc.address WHERE id = ?')
      .get(row.address_id) as { city: string } | undefined
    return found?.city ?? ''
  }

  private targetCity(row: Row): string {
    if (row.address_id === null || row.address_id === undefined) return ''
    const found = this.db
      .prepare('SELECT city FROM main.address WHERE id = ?')
      .get(row.address_id) as { city: string } | undefined
    return found?.city ?? ''
  }

  private localEmail(row: Row): string {
    if (row.contact_id === null || row.contact_id === undefined) return ''
    const found = this.db
      .prepare('SELECT email FROM loc.contact WHERE id = ?')
      .get(row.contact_id) as { email: string } | undefined
    return found?.email ?? ''
  }

  private targetEmail(row: Row): string {
    if (row.contact_id === null || row.contact_id === undefined) return ''
    const found = this.db
      .prepare('SELECT email FROM main.contact WHERE id = ?')
      .get(row.contact_id) as { email: string } | undefined
    return found?.email ?? ''
  }
}
