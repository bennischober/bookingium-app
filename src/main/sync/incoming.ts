// ========================================
// Applying another computer's batch
// ========================================
// Per field, the newer change wins (hybrid clock, store.ts sync_clock). A delete wins over
// changes to the row from elsewhere. A row created on both computers that is the same thing
// (ALIAS_KEYS) becomes an alias of the local one. What cannot be applied is recorded in
// sync_conflict and skipped; the rest of the batch goes on.
import { TERMS } from '../api/terms'
import type { Batch, RowChange } from './format'
import type { HybridClock } from './hlc'
import { ALIAS_KEYS, isLocalSettingKey, type AliasKey } from './tables'
import {
  SchemaInfo,
  keyColumn,
  quoteIdent as q,
  setPeer,
  whileApplying,
  type Sqlite
} from './store'

type Values = Record<string, unknown>

export type ApplyResult = { applied: number; conflicts: number }

const errorCode = (error: unknown) => (error as { code?: string }).code ?? ''
const isUnique = (error: unknown) =>
  errorCode(error) === 'SQLITE_CONSTRAINT_UNIQUE' ||
  errorCode(error) === 'SQLITE_CONSTRAINT_PRIMARYKEY'
const isForeignKey = (error: unknown) => errorCode(error) === 'SQLITE_CONSTRAINT_FOREIGNKEY'
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** German name of a table for conflict messages (the UI's nouns, terms.ts) */
const TABLE_LABELS: Record<string, string> = {
  invoice: TERMS.invoice.singular,
  deal_memo: TERMS.event.singular,
  band: TERMS.band.singular,
  person: TERMS.person.singular,
  company: TERMS.company.singular,
  venue: `${TERMS.club.singular} / ${TERMS.festival.singular}`,
  hotel: TERMS.hotel.singular,
  contact_list: TERMS.contactList.singular,
  management_contract: TERMS.contract.singular,
  document: 'Dokument'
}
export const tableLabel = (table: string) => TABLE_LABELS[table] ?? `Eintrag (${table})`

export class BatchApplier {
  private applied = 0
  private conflicts = 0

  constructor(
    private sqlite: Sqlite,
    private schema: SchemaInfo,
    private clock: HybridClock,
    private now: () => Date = () => new Date()
  ) {}

  /**
   * Applies the batch in one transaction and records it as applied.
   *
   * #262 `record`: an employee's change the staff bridge took (staff/bridge.ts). It is written
   * with the change triggers on, so it goes to the other admin computers as this computer's own
   * change; the employee's device is no peer of the group, and its files take another way.
   */
  apply(batch: Batch, options: { record?: boolean } = {}): ApplyResult {
    this.applied = 0
    this.conflicts = 0
    const around = options.record ? <T>(_sqlite: Sqlite, work: () => T): T => work() : whileApplying
    this.sqlite.transaction(() => {
      around(this.sqlite, () => {
        for (const row of batch.rows) {
          this.clock.receive(row.h)
          try {
            // one savepoint per row: a failure undoes that row only
            this.sqlite.transaction(() => this.applyRow(batch.device, row))()
          } catch (error) {
            this.conflict(batch.device, row, `Änderung nicht übernommen: ${message(error)}`)
          }
        }
        const pending = this.sqlite.prepare(
          'INSERT INTO sync_file_pending (path, sha, hlc) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET sha = excluded.sha, hlc = excluded.hlc WHERE excluded.hlc > sync_file_pending.hlc'
        )
        const tombFile = this.sqlite.prepare(
          "INSERT INTO sync_file_pending (path, sha, hlc) VALUES (?, '', ?) ON CONFLICT(path) DO UPDATE SET sha = '', hlc = excluded.hlc WHERE excluded.hlc > sync_file_pending.hlc"
        )
        for (const file of options.record ? [] : batch.files) {
          this.clock.receive(file.h)
          // sha '' marks a removal; the file step does the disk work after the transaction
          if (file.s) pending.run(file.p, file.s, file.h)
          else tombFile.run(file.p, file.h)
        }
      })
      if (!options.record) setPeer(this.sqlite, batch.device, batch.seq)
      this.sqlite
        .prepare(
          "INSERT INTO sync_meta (key, value) VALUES ('hlc', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        .run(this.clock.current())
    })()
    return { applied: this.applied, conflicts: this.conflicts }
  }

  // ---------- rows ----------

  private applyRow(device: string, row: RowChange): void {
    const { t: table } = row
    if (!this.schema.has(table)) return
    if (table === 'app_setting' && isLocalSettingKey(row.k)) return
    const pk = this.resolveAlias(table, row.k)
    const tomb = this.tombOf(table, pk)
    const values = this.translate(table, this.knownColumns(table, row.c ?? {}))

    if (row.o === 'd') {
      if (!this.exists(table, pk)) {
        this.setTomb(table, pk, row.h)
        return
      }
      try {
        this.sqlite
          .prepare(`DELETE FROM ${q(table)} WHERE ${q(keyColumn(table))} = ?`)
          .run(this.keyValue(table, pk))
      } catch (error) {
        if (isForeignKey(error)) {
          this.conflict(
            device,
            row,
            `${tableLabel(table)} wurde auf dem anderen Computer gelöscht, wird hier aber noch verwendet und bleibt deshalb erhalten.`
          )
          return
        }
        throw error
      }
      this.setTomb(table, pk, row.h)
      this.sqlite.prepare('DELETE FROM sync_clock WHERE tbl = ? AND pk = ?').run(table, pk)
      this.applied++
      return
    }

    if (tomb !== null) {
      // a later insert of the same key (a setting saved again) brings the row back
      if (row.o === 'u' || row.h <= tomb) return
      this.sqlite.prepare('DELETE FROM sync_tomb WHERE tbl = ? AND pk = ?').run(table, pk)
    }

    if (this.exists(table, pk)) {
      this.update(device, row, table, pk, values)
      return
    }
    if (row.o === 'u') {
      // the row's insert was not taken (an earlier conflict) or the batch with it is missing
      if (!this.hasConflict(table, row.k))
        this.conflict(
          device,
          row,
          `${tableLabel(table)} fehlt hier, die Änderung daran wurde übersprungen.`
        )
      return
    }
    this.insert(device, row, table, pk, values)
  }

  private insert(device: string, row: RowChange, table: string, pk: string, values: Values): void {
    const key = keyColumn(table)
    const record: Values = { ...values, [key]: this.keyValue(table, pk) }
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const columns = Object.keys(record)
        this.sqlite
          .prepare(
            `INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
          )
          .run(...columns.map((c) => record[c]))
        this.setClock(table, pk, '*', row.h)
        this.applied++
        return
      } catch (error) {
        if (isUnique(error)) {
          if (this.aliasInsert(device, row, table, record)) return
          if (table === 'company' && record.is_default_for_invoicing) {
            if (this.takeDefaultCompany(row.h)) continue
            record.is_default_for_invoicing = 0
            continue
          }
          this.conflict(device, row, this.uniqueMessage(table, record))
          return
        }
        if (isForeignKey(error)) {
          const missing = this.missingParents(table, record)
          const required = missing.filter((column) => this.notNull(table, column))
          if (required.length > 0) {
            // its parent was deleted here at the same time: the row goes with it, as a cascade would
            this.setTomb(table, pk, row.h)
            return
          }
          if (missing.length === 0) throw error
          for (const column of missing) record[column] = null
          continue
        }
        throw error
      }
    }
    this.conflict(device, row, `${tableLabel(table)} konnte nicht übernommen werden.`)
  }

  private update(device: string, row: RowChange, table: string, pk: string, values: Values): void {
    const key = keyColumn(table)
    const clocks = new Map(
      (
        this.sqlite
          .prepare('SELECT col, hlc FROM sync_clock WHERE tbl = ? AND pk = ?')
          .all(table, pk) as Array<{
          col: string
          hlc: string
        }>
      ).map((c) => [c.col, c.hlc])
    )
    const rowClock = clocks.get('*') ?? ''
    const winners: Values = {}
    for (const [column, value] of Object.entries(values)) {
      if (column === key) continue
      if (row.h > (clocks.get(column) ?? rowClock)) winners[column] = value
    }
    if (Object.keys(winners).length === 0) return
    for (let attempt = 0; attempt < 4; attempt++) {
      const columns = Object.keys(winners)
      if (columns.length === 0) return
      try {
        this.sqlite
          .prepare(
            `UPDATE ${q(table)} SET ${columns.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${q(key)} = ?`
          )
          .run(...columns.map((c) => winners[c]), this.keyValue(table, pk))
        for (const column of columns) this.setClock(table, pk, column, row.h)
        this.applied++
        return
      } catch (error) {
        if (isUnique(error)) {
          if (table === 'company' && winners.is_default_for_invoicing) {
            if (this.takeDefaultCompany(row.h)) continue
            delete winners.is_default_for_invoicing
            continue
          }
          this.conflict(
            device,
            row,
            this.uniqueMessage(table, { ...this.current(table, pk), ...winners })
          )
          return
        }
        if (isForeignKey(error)) {
          const missing = this.missingParents(table, winners)
          if (missing.length === 0) throw error
          for (const column of missing) {
            if (this.notNull(table, column)) delete winners[column]
            else winners[column] = null
          }
          continue
        }
        throw error
      }
    }
  }

  // ---------- aliases ----------

  /**
   * The incoming row clashes with a local one on a unique key. For ALIAS_KEYS tables that is the
   * same thing created on both computers: remember the alias and merge the fields into the local
   * row. Returns false when the table has no such key or no local row matches.
   */
  private aliasInsert(device: string, row: RowChange, table: string, record: Values): boolean {
    const keys = ALIAS_KEYS[table]
    if (!keys) return false
    for (const aliasKey of keys) {
      const local = this.findByKey(table, aliasKey, record)
      if (local === null) continue
      this.sqlite
        .prepare('INSERT OR REPLACE INTO sync_alias (tbl, remote_pk, local_pk) VALUES (?, ?, ?)')
        .run(table, row.k, local)
      const values = { ...record }
      delete values[keyColumn(table)]
      this.update(device, row, table, local, values)
      return true
    }
    return false
  }

  private findByKey(table: string, aliasKey: AliasKey, record: Values): string | null {
    if (aliasKey.columns.some((c) => record[c] === undefined || record[c] === null)) return null
    const where = aliasKey.columns
      .map((c) => (aliasKey.nocase?.includes(c) ? `${q(c)} = ? COLLATE NOCASE` : `${q(c)} IS ?`))
      .join(' AND ')
    const found = this.sqlite
      .prepare(`SELECT CAST(${q(keyColumn(table))} AS TEXT) AS pk FROM ${q(table)} WHERE ${where}`)
      .get(...aliasKey.columns.map((c) => record[c])) as { pk: string } | undefined
    return found?.pk ?? null
  }

  private resolveAlias(table: string, pk: string): string {
    const row = this.sqlite
      .prepare('SELECT local_pk FROM sync_alias WHERE tbl = ? AND remote_pk = ?')
      .get(table, pk) as { local_pk: string } | undefined
    return row?.local_pk ?? pk
  }

  /** Foreign keys pointing at an aliased row point at the local one instead */
  private translate(table: string, values: Values): Values {
    const result = { ...values }
    for (const fk of this.schema.foreignKeysOf(table)) {
      const value = result[fk.from]
      if (value === undefined || value === null) continue
      const local = this.resolveAlias(fk.table, String(value))
      if (local !== String(value)) result[fk.from] = Number(local)
    }
    return result
  }

  // ---------- the one default company ----------

  /**
   * Two computers marked different companies as the default for invoices. The newer mark wins:
   * returns true after clearing the local one (the incoming row may then keep its mark).
   */
  private takeDefaultCompany(h: string): boolean {
    const local = this.sqlite
      .prepare('SELECT CAST(id AS TEXT) AS pk FROM company WHERE is_default_for_invoicing = 1')
      .get() as { pk: string } | undefined
    if (!local) return true
    const clock = this.sqlite
      .prepare(
        "SELECT hlc FROM sync_clock WHERE tbl = 'company' AND pk = ? AND col IN ('is_default_for_invoicing', '*') ORDER BY col = '*' LIMIT 1"
      )
      .get(local.pk) as { hlc: string } | undefined
    if (h <= (clock?.hlc ?? '')) return false
    this.sqlite
      .prepare('UPDATE company SET is_default_for_invoicing = 0 WHERE id = ?')
      .run(Number(local.pk))
    this.setClock('company', local.pk, 'is_default_for_invoicing', h)
    return true
  }

  // ---------- helpers ----------

  private knownColumns(table: string, values: Values): Values {
    const known = this.schema.columnNames(table)
    return Object.fromEntries(Object.entries(values).filter(([column]) => known.has(column)))
  }

  private keyValue(table: string, pk: string): string | number {
    return keyColumn(table) === 'id' ? Number(pk) : pk
  }

  private exists(table: string, pk: string): boolean {
    return !!this.sqlite
      .prepare(`SELECT 1 FROM ${q(table)} WHERE ${q(keyColumn(table))} = ?`)
      .get(this.keyValue(table, pk))
  }

  private current(table: string, pk: string): Values {
    return (
      (this.sqlite
        .prepare(`SELECT * FROM ${q(table)} WHERE ${q(keyColumn(table))} = ?`)
        .get(this.keyValue(table, pk)) as Values | undefined) ?? {}
    )
  }

  private notNull(table: string, column: string): boolean {
    return this.schema.columnsOf(table).some((c) => c.name === column && c.notnull === 1)
  }

  /** Foreign key columns of `values` whose referenced row does not exist here */
  private missingParents(table: string, values: Values): string[] {
    const missing: string[] = []
    for (const fk of this.schema.foreignKeysOf(table)) {
      const value = values[fk.from]
      if (value === undefined || value === null) continue
      const found = this.sqlite
        .prepare(`SELECT 1 FROM ${q(fk.table)} WHERE ${q(keyColumn(fk.table))} = ?`)
        .get(value)
      if (!found) missing.push(fk.from)
    }
    return missing
  }

  private tombOf(table: string, pk: string): string | null {
    const row = this.sqlite
      .prepare('SELECT hlc FROM sync_tomb WHERE tbl = ? AND pk = ?')
      .get(table, pk) as { hlc: string } | undefined
    return row?.hlc ?? null
  }

  private setTomb(table: string, pk: string, h: string): void {
    this.sqlite
      .prepare(
        'INSERT INTO sync_tomb (tbl, pk, hlc) VALUES (?, ?, ?) ON CONFLICT(tbl, pk) DO UPDATE SET hlc = MAX(hlc, excluded.hlc)'
      )
      .run(table, pk, h)
  }

  private setClock(table: string, pk: string, column: string, h: string): void {
    this.sqlite
      .prepare(
        'INSERT INTO sync_clock (tbl, pk, col, hlc) VALUES (?, ?, ?, ?) ON CONFLICT(tbl, pk, col) DO UPDATE SET hlc = MAX(hlc, excluded.hlc)'
      )
      .run(table, pk, column, h)
  }

  private hasConflict(table: string, pk: string): boolean {
    return !!this.sqlite
      .prepare('SELECT 1 FROM sync_conflict WHERE tbl = ? AND pk = ?')
      .get(table, pk)
  }

  private uniqueMessage(table: string, record: Values): string {
    if (table === 'invoice' && record.invoice_number != null)
      return `Rechnung Nr. ${String(record.invoice_number)} vom anderen Computer wurde nicht übernommen: Die Nummer ist hier schon an eine andere Rechnung vergeben. Bitte eine der beiden Rechnungen stornieren und neu stellen.`
    return `${tableLabel(table)} vom anderen Computer wurde nicht übernommen, weil es hier schon einen gleichen Eintrag gibt.`
  }

  private conflict(device: string, row: RowChange, text: string): void {
    this.conflicts++
    this.sqlite
      .prepare(
        'INSERT INTO sync_conflict (at, device, tbl, pk, message, data) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(this.now().toISOString(), device, row.t, row.k, text, JSON.stringify(row))
  }
}
