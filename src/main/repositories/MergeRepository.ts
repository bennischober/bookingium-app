import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db, getSqlite } from '../db'
import { schema } from '../db/schema'
import { deleteUnusedCompanions } from './companions'
import { deleteUnusedGenres } from './genres'
import { companyKey, normalizeKey } from '../import/normalize'
import type {
  DuplicateGroupDto,
  MergeCandidateDto,
  MergeFieldDto,
  MergeInput,
  MergeKind,
  MergePairInput,
  MergePreviewDto
} from '../api/schemas/merge.schema'

/**
 * #249: merges two records of one kind (company, person, club/festival) into one.
 *
 * Everything that points at the removed record is moved to the kept one: every foreign key in
 * the database (found by `PRAGMA foreign_key_list`, so a new table is covered without a change
 * here) and the three references by type and id (documents, mail links, mail rules). A link row
 * that the kept record already has (the same person in a band twice) is dropped; any other
 * clash stops the merge before anything is written. Empty fields of the kept record are filled
 * from the other one, differing ones as the user chose; notes are joined.
 *
 * Plain SQL statements on the same connection inside one transaction, so the sync triggers
 * record every change like any other write and another computer receives the merge as updates
 * plus the deletion.
 */

type Row = Record<string, unknown>

/** Per kind: its table, the fields offered as a choice (column → label) and its name */
const KINDS: Record<
  MergeKind,
  { table: string; fields: Record<string, string>; name: (row: Row) => string }
> = {
  company: {
    table: 'company',
    fields: {
      name: 'Name',
      vat_id: 'USt-IdNr.',
      tax_number: 'Steuernummer',
      commercial_register_no: 'Registernummer',
      register_court: 'Registergericht',
      ksk_number: 'KSK-Nummer',
      customer_number: 'Kundennummer'
    },
    name: (row) => String(row.name ?? '')
  },
  person: {
    table: 'person',
    fields: {
      first_name: 'Vorname',
      last_name: 'Nachname',
      birthday: 'Geburtstag',
      customer_number: 'Kundennummer'
    },
    name: (row) => `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
  },
  band: {
    table: 'band',
    fields: {
      name: 'Name',
      founded: 'Gegründet',
      customer_number: 'Kundennummer'
    },
    name: (row) => String(row.name ?? '')
  },
  venue: {
    table: 'venue',
    fields: {
      name: 'Name',
      kind: 'Art',
      capacity: 'Kapazität',
      radius_km: 'Gebietsschutz (km)',
      radius_weeks_before: 'Gebietsschutz (Wochen vorher)',
      radius_weeks_after: 'Gebietsschutz (Wochen nachher)'
    },
    name: (row) => String(row.name ?? '')
  }
}

/** Columns never copied between the two records */
const SKIP = new Set(['id', 'created_at', 'updated_at', 'notes', 'address_id', 'contact_id'])

/** What moves, as the preview names it; tables not listed move silently */
const MOVE_LABELS: Record<string, [string, string]> = {
  deal_memo: ['Event', 'Events'],
  invoice: ['Rechnung', 'Rechnungen'],
  band: ['Band', 'Bands'],
  venue: ['Club/Festival', 'Clubs/Festivals'],
  band_member: ['Bandmitgliedschaft', 'Bandmitgliedschaften'],
  venue_member: ['Kontakt an einem Ort', 'Kontakte an Orten'],
  company_member: ['Mitarbeitende', 'Mitarbeitende'],
  contact_list_member: ['Verteiler-Eintrag', 'Verteiler-Einträge'],
  follow_up: ['Wiedervorlage', 'Wiedervorlagen'],
  appointment: ['Termin', 'Termine'],
  receipt: ['Beleg', 'Belege'],
  trip: ['Reise', 'Reisen'],
  management_contract: ['Management-Vertrag', 'Management-Verträge'],
  event_advancing: ['Advancing', 'Advancing'],
  document: ['Dokument', 'Dokumente'],
  mail_link: ['E-Mail-Verknüpfung', 'E-Mail-Verknüpfungen']
}

/** References by type and id instead of a foreign key */
const TYPED_REFERENCES: Array<{ table: string; type: string; id: string }> = [
  { table: 'document', type: 'owner_type', id: 'owner_id' },
  { table: 'mail_link', type: 'entity_type', id: 'entity_id' },
  { table: 'mail_rule', type: 'link_entity_type', id: 'link_entity_id' }
]

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`
const filled = (value: unknown): boolean => value !== null && value !== undefined && value !== ''
const text = (value: unknown): string => (filled(value) ? String(value) : '')

type Reference = { table: string; column: string; link: boolean }

@injectable()
export class MergeRepository {
  /** Every foreign key column that points at the table; `link` when clashes may be dropped */
  private references(target: string): Reference[] {
    const sqlite = getSqlite()
    const tables = (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
    const refs: Reference[] = []
    for (const table of tables) {
      const fks = sqlite.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all() as Array<{
        table: string
        from: string
      }>
      const fkColumns = new Set(fks.map((fk) => fk.from))
      for (const fk of fks.filter((fk) => fk.table === target)) {
        // A link row: a unique index of foreign keys only (band + person, list + person …)
        const link = (
          sqlite.prepare(`PRAGMA index_list(${quote(table)})`).all() as Array<{
            name: string
            unique: number
          }>
        )
          .filter((index) => index.unique === 1)
          .some((index) => {
            const columns = (
              sqlite.prepare(`PRAGMA index_info(${quote(index.name)})`).all() as Array<{
                name: string | null
              }>
            ).map((column) => column.name)
            return (
              columns.includes(fk.from) &&
              columns.every((column) => column !== null && fkColumns.has(column))
            )
          })
        refs.push({ table, column: fk.from, link })
      }
    }
    return refs
  }

  private row(table: string, id: number): Row | undefined {
    return getSqlite()
      .prepare(`SELECT * FROM ${quote(table)} WHERE id = ?`)
      .get(id) as Row | undefined
  }

  private pair(input: MergePairInput): { keep: Row; drop: Row } {
    if (input.keepId === input.dropId) throw new Error('Bitte zwei verschiedene Einträge wählen.')
    const { table } = KINDS[input.kind]
    const keep = this.row(table, input.keepId)
    const drop = this.row(table, input.dropId)
    if (!keep || !drop) throw new Error('Einer der beiden Einträge existiert nicht mehr.')
    return { keep, drop }
  }

  private contactLine(contactId: unknown): string {
    if (!filled(contactId)) return ''
    const contact = db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.id, Number(contactId)))
      .get()
    return contact ? [contact.email, contact.phone].filter(Boolean).join(' · ') : ''
  }

  private addressLine(addressId: unknown): string {
    if (!filled(addressId)) return ''
    const a = db
      .select()
      .from(schema.address)
      .where(eq(schema.address.id, Number(addressId)))
      .get()
    if (!a) return ''
    return [
      [a.street, a.street_number].filter(Boolean).join(' '),
      [a.zip_code, a.city].filter(Boolean).join(' ')
    ]
      .filter(Boolean)
      .join(', ')
  }

  preview(input: MergePairInput): MergePreviewDto {
    const kind = KINDS[input.kind]
    const { keep, drop } = this.pair(input)
    const fields: MergeFieldDto[] = []
    const fills: MergePreviewDto['fills'] = []
    for (const [column, label] of Object.entries(kind.fields)) {
      if (!filled(drop[column])) continue
      if (!filled(keep[column])) fills.push({ label, value: text(drop[column]) })
      else if (text(keep[column]) !== text(drop[column]))
        fields.push({ key: column, label, keep: text(keep[column]), drop: text(drop[column]) })
    }
    for (const [key, label, line] of [
      ['address_id', 'Adresse', (id: unknown) => this.addressLine(id)],
      ['contact_id', 'Kontakt (E-Mail, Telefon)', (id: unknown) => this.contactLine(id)]
    ] as const) {
      const keepLine = line(keep[key])
      const dropLine = line(drop[key])
      if (!dropLine) continue
      if (!keepLine) fills.push({ label, value: dropLine })
      else if (keepLine !== dropLine) fields.push({ key, label, keep: keepLine, drop: dropLine })
    }
    if (filled(drop.notes) && text(drop.notes) !== text(keep.notes))
      fills.push({ label: 'Anmerkungen (werden angehängt)', value: text(drop.notes) })

    const counts = new Map<string, number>()
    const sqlite = getSqlite()
    for (const ref of this.references(kind.table)) {
      if (ref.table === kind.table) continue
      const n = (
        sqlite
          .prepare(`SELECT count(*) AS n FROM ${quote(ref.table)} WHERE ${quote(ref.column)} = ?`)
          .get(input.dropId) as { n: number }
      ).n
      if (n > 0) counts.set(ref.table, (counts.get(ref.table) ?? 0) + n)
    }
    for (const ref of TYPED_REFERENCES) {
      const n = (
        sqlite
          .prepare(
            `SELECT count(*) AS n FROM ${quote(ref.table)} WHERE ${quote(ref.type)} = ? AND ${quote(ref.id)} = ?`
          )
          .get(input.kind, input.dropId) as { n: number }
      ).n
      if (n > 0) counts.set(ref.table, (counts.get(ref.table) ?? 0) + n)
    }
    const moves = [...counts.entries()]
      .filter(([table]) => MOVE_LABELS[table])
      .map(([table, count]) => ({
        label: MOVE_LABELS[table][count === 1 ? 0 : 1],
        count
      }))

    return {
      keep: { id: input.keepId, name: kind.name(keep) },
      drop: { id: input.dropId, name: kind.name(drop) },
      fields,
      fills,
      moves
    }
  }

  /** Merges; returns the kept record's id */
  merge(input: MergeInput): number {
    const kind = KINDS[input.kind]
    const sqlite = getSqlite()
    const take = new Set(input.take)
    // drizzle's transaction on the same connection: the plain statements below run inside it
    db.transaction((tx) => {
      const { keep, drop } = this.pair(input)
      const t = quote(kind.table)

      // ---- fields of the kept record ----
      const set: Row = {}
      for (const column of Object.keys(keep)) {
        if (SKIP.has(column)) continue
        const fromDrop = take.has(column)
          ? filled(drop[column])
          : !filled(keep[column]) && filled(drop[column])
        if (fromDrop) set[column] = drop[column]
      }
      // a capacity range goes with its upper end
      if ('capacity' in set && kind.table === 'venue') set.capacity_min = drop.capacity_min ?? null
      if (filled(drop.notes) && text(drop.notes) !== text(keep.notes))
        set.notes = [text(keep.notes), text(drop.notes)].filter(Boolean).join('\n\n')
      // the main company for invoicing stays the main company
      if (drop.is_default_for_invoicing) set.is_default_for_invoicing = 1

      // ---- address and contact ----
      for (const key of ['address_id', 'contact_id'] as const) {
        if (!(key in keep)) continue
        if (filled(drop[key]) && (!filled(keep[key]) || take.has(key))) set[key] = drop[key]
      }
      const keptContact = (set.contact_id ?? keep.contact_id) as number | null
      const otherContact = (keptContact === keep.contact_id ? drop.contact_id : keep.contact_id) as
        | number
        | null
      if (filled(keptContact) && filled(otherContact) && keptContact !== otherContact) {
        this.mergeContacts(Number(keptContact), Number(otherContact))
      }

      // unique columns (Kundennummer) must leave the removed record first
      if ('customer_number' in set) {
        sqlite.prepare(`UPDATE ${t} SET customer_number = NULL WHERE id = ?`).run(input.dropId)
      }
      const columns = Object.keys(set)
      if (columns.length > 0) {
        sqlite
          .prepare(
            `UPDATE ${t} SET ${columns.map((c) => `${quote(c)} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`
          )
          .run({
            ...Object.fromEntries(
              columns.map((c) => [c, typeof set[c] === 'boolean' ? Number(set[c]) : set[c]])
            ),
            id: input.keepId
          })
      }

      // ---- everything pointing at the removed record ----
      for (const ref of this.references(kind.table)) {
        const table = quote(ref.table)
        const column = quote(ref.column)
        sqlite
          .prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`)
          .run(input.keepId, input.dropId)
        const left = (
          sqlite
            .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
            .get(input.dropId) as { n: number }
        ).n
        if (left === 0) continue
        if (!ref.link) {
          throw new Error(
            `Zusammenführen nicht möglich: ${left} Einträge in „${ref.table}“ würden mit denen des anderen Eintrags kollidieren.`
          )
        }
        // the kept record has this link already
        sqlite.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(input.dropId)
      }
      for (const ref of TYPED_REFERENCES) {
        const table = quote(ref.table)
        const where = `${quote(ref.type)} = ? AND ${quote(ref.id)} = ?`
        sqlite
          .prepare(`UPDATE OR IGNORE ${table} SET ${quote(ref.id)} = ? WHERE ${where}`)
          .run(input.keepId, input.kind, input.dropId)
        sqlite.prepare(`DELETE FROM ${table} WHERE ${where}`).run(input.kind, input.dropId)
      }

      sqlite.prepare(`DELETE FROM ${t} WHERE id = ?`).run(input.dropId)
      {
        deleteUnusedCompanions(tx, {
          address_id: (drop.address_id as number | null) ?? null,
          contact_id: (drop.contact_id as number | null) ?? null
        })
        // and the kept record's own, when it took the other one's
        deleteUnusedCompanions(tx, {
          address_id: (keep.address_id as number | null) ?? null,
          contact_id: (keep.contact_id as number | null) ?? null
        })
        deleteUnusedGenres(tx)
      }
    })
    return input.keepId
  }

  /** The other contact's addresses join the kept one as further addresses; empty fields fill */
  private mergeContacts(keptId: number, otherId: number): void {
    const kept = db.select().from(schema.contact).where(eq(schema.contact.id, keptId)).get()
    const other = db.select().from(schema.contact).where(eq(schema.contact.id, otherId)).get()
    if (!kept || !other) return
    const known = new Set(
      [
        kept.email,
        ...db
          .select({ email: schema.contact_email.email })
          .from(schema.contact_email)
          .where(eq(schema.contact_email.contact_id, keptId))
          .all()
          .map((row) => row.email)
      ].map((email) => email.trim().toLowerCase())
    )
    const add = [
      other.email,
      ...db
        .select({ email: schema.contact_email.email })
        .from(schema.contact_email)
        .where(eq(schema.contact_email.contact_id, otherId))
        .all()
        .map((row) => row.email)
    ]
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email && !known.has(email))
    let position = known.size
    for (const email of new Set(add)) {
      db.insert(schema.contact_email)
        .values({ contact_id: keptId, email, position: position++ })
        .run()
    }
    const fill: Partial<typeof schema.contact.$inferInsert> = {}
    if (!kept.email && other.email) fill.email = other.email
    if (!kept.phone && other.phone) fill.phone = other.phone
    if (!kept.mobile_phone && other.mobile_phone) fill.mobile_phone = other.mobile_phone
    if (!kept.homepage && other.homepage) fill.homepage = other.homepage
    if (other.no_advertising) fill.no_advertising = true
    if (Object.keys(fill).length > 0) {
      db.update(schema.contact).set(fill).where(eq(schema.contact.id, keptId)).run()
    }
  }

  /** Records that may be the same as this one, with the reason */
  /**
   * Every group of records of one kind with the same name (companies: legal form aside, so
   * "Beispiel GmbH" and "Beispiel" match), largest groups first: the list behind
   * "Doppelte Einträge", each group merged with the existing dialog
   */
  duplicateGroups(kind: MergeKind): DuplicateGroupDto[] {
    const config = KINDS[kind]
    const rows = getSqlite()
      .prepare(`SELECT * FROM ${quote(config.table)}`)
      .all() as Row[]
    const groups = new Map<string, Array<{ id: number; name: string }>>()
    for (const row of rows) {
      const name = config.name(row)
      const key = kind === 'company' ? companyKey(name) : normalizeKey(name)
      if (!key) continue
      const group = groups.get(key) ?? []
      group.push({ id: Number(row.id), name })
      groups.set(key, group)
    }
    return [...groups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([key, items]) => ({ key, items: items.sort((a, b) => a.id - b.id) }))
      .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key))
  }

  candidates(kind: MergeKind, id: number): MergeCandidateDto[] {
    const sqlite = getSqlite()
    const emailsOf = (contactId: unknown): string[] =>
      filled(contactId)
        ? (
            sqlite
              .prepare(
                'SELECT email FROM contact WHERE id = ? UNION SELECT email FROM contact_email WHERE contact_id = ?'
              )
              .all(contactId, contactId) as Array<{ email: string }>
          )
            .map((row) => row.email.trim().toLowerCase())
            .filter(Boolean)
        : []
    const config = KINDS[kind]
    const rows = sqlite.prepare(`SELECT * FROM ${quote(config.table)}`).all() as Row[]
    const self = rows.find((row) => row.id === id)
    if (!self) return []
    const nameKey = (row: Row): string =>
      kind === 'company' ? companyKey(config.name(row)) : normalizeKey(config.name(row))
    const selfName = nameKey(self)
    const selfEmails = new Set(emailsOf(self.contact_id))
    const found: MergeCandidateDto[] = []
    for (const row of rows) {
      if (row.id === id) continue
      const reasons: string[] = []
      if (selfName && nameKey(row) === selfName) reasons.push('gleicher Name')
      if (
        kind === 'company' &&
        filled(self.vat_id) &&
        text(row.vat_id).replace(/\s/g, '').toUpperCase() ===
          text(self.vat_id).replace(/\s/g, '').toUpperCase()
      )
        reasons.push('gleiche USt-IdNr.')
      if (selfEmails.size > 0 && emailsOf(row.contact_id).some((email) => selfEmails.has(email)))
        reasons.push('gleiche E-Mail')
      if (reasons.length > 0)
        found.push({ id: Number(row.id), name: config.name(row), reason: reasons.join(', ') })
    }
    return found.slice(0, 20)
  }
}
