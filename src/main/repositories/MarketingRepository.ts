import { injectable } from 'tsyringe'
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { Tx } from './tx'
import { companyKey, countryByCode, normalizeKey } from '../import/normalize'
import {
  contactKindOf,
  findRenames,
  itemKey,
  textsDiffer,
  type Atlas,
  type AtlasItem
} from '../marketing/atlasFormat'
import { locate } from '../map/markers'
import {
  MARKETING_CATEGORY_LABELS,
  type MarketingCategory,
  type MarketingContactCandidateDto,
  type MarketingFileDto,
  type MarketingFileEntryDto,
  type MarketingImportResultDto,
  type MarketingStatus,
  type UpdateMarketingItemInput
} from '../api/schemas/marketing.schema'

type ItemRow = typeof schema.marketing_item.$inferSelect
type AtlasRow = typeof schema.marketing_atlas.$inferSelect
export type MarketingItemRow = ItemRow & {
  companyName: string | null
  venueName: string | null
  /** Where the linked company or venue is (postcode precision), for the map */
  location: { lat: number; lng: number } | null
}

/** What an import overwrites, kept to take it back */
type UndoSnapshot = { atlas: AtlasRow | null; items: ItemRow[] }

type ContactKind = 'media' | 'venue' | 'festival'
type Link = { company_id: number } | { venue_id: number }
type Counts = { companies: number; venues: number; ambiguous: number }

/**
 * The address book as an import needs it: companies and venues by name key, kind and email,
 * read once per transaction instead of once per entry. Records created during the import are
 * added, so a second entry of that name finds the first.
 */
class AddressBook {
  private companies: Array<{ id: number; key: string; name: string; place: string }>
  private venues: Array<{ id: number; key: string; kind: string; name: string; place: string }>
  private byEmail = new Map<string, Link[]>()

  constructor(tx: Tx) {
    this.companies = tx
      .select({
        id: schema.company.id,
        name: schema.company.name,
        email: schema.contact.email,
        city: schema.address.city,
        country: schema.address.country
      })
      .from(schema.company)
      .leftJoin(schema.contact, eq(schema.contact.id, schema.company.contact_id))
      .leftJoin(schema.address, eq(schema.address.id, schema.company.address_id))
      .all()
      .map((row) => {
        this.addEmail(row.email, { company_id: row.id })
        return {
          id: row.id,
          key: companyKey(row.name),
          name: row.name,
          place: row.city || row.country || ''
        }
      })
    this.venues = tx
      .select({
        id: schema.venue.id,
        name: schema.venue.name,
        kind: schema.venue.kind,
        email: schema.contact.email,
        city: schema.address.city,
        country: schema.address.country
      })
      .from(schema.venue)
      .leftJoin(schema.contact, eq(schema.contact.id, schema.venue.contact_id))
      .leftJoin(schema.address, eq(schema.address.id, schema.venue.address_id))
      .all()
      .map((row) => {
        this.addEmail(row.email, { venue_id: row.id })
        return {
          id: row.id,
          key: normalizeKey(row.name),
          kind: row.kind,
          name: row.name,
          place: row.city || row.country || ''
        }
      })
  }

  private addEmail(email: string | null, link: Link): void {
    const key = (email ?? '').trim().toLowerCase()
    if (!key) return
    this.byEmail.set(key, [...(this.byEmail.get(key) ?? []), link])
  }

  /** The records of the entry's name (venues of the other kind only when none of its own) */
  candidates(item: Pick<AtlasItem, 'name'>, kind: ContactKind): MarketingContactCandidateDto[] {
    if (kind === 'media') {
      const key = companyKey(item.name)
      return this.companies
        .filter((c) => c.key === key)
        .map((c) => ({ kind: 'company' as const, id: c.id, name: c.name, place: c.place }))
    }
    const key = normalizeKey(item.name)
    const named = this.venues.filter((v) => v.key === key)
    const ownKind = named.filter((v) => (v.kind === 'festival') === (kind === 'festival'))
    return (ownKind.length > 0 ? ownKind : named).map((v) => ({
      kind: 'venue' as const,
      id: v.id,
      name: v.name,
      place: v.place
    }))
  }

  /**
   * The one record an entry belongs to: by its contact email first (stronger than the name),
   * then by name; 'ambiguous' when several fit, null when none
   */
  find(item: AtlasItem, kind: ContactKind): Link | 'ambiguous' | null {
    const email = item.contact.email.trim().toLowerCase()
    if (email) {
      const wanted = kind === 'media' ? 'company_id' : 'venue_id'
      const byEmail = (this.byEmail.get(email) ?? []).filter((link) => wanted in link)
      if (byEmail.length === 1) return byEmail[0]
    }
    const named = this.candidates(item, kind)
    if (named.length === 1)
      return named[0].kind === 'company' ? { company_id: named[0].id } : { venue_id: named[0].id }
    return named.length > 1 ? 'ambiguous' : null
  }

  added(link: Link, item: AtlasItem, kind: ContactKind): void {
    this.addEmail(item.contact.email, link)
    if ('company_id' in link)
      this.companies.push({
        id: link.company_id,
        key: companyKey(item.name),
        name: item.name,
        place: ''
      })
    else
      this.venues.push({
        id: link.venue_id,
        key: normalizeKey(item.name),
        kind: kind === 'festival' ? 'festival' : 'venue',
        name: item.name,
        place: ''
      })
  }
}

/**
 * Marketing-Atlas of a band (#marketing): its head data and entries, the import of a newer atlas,
 * and the links to the address book.
 *
 * The atlas is research with hundreds of entries; the band works with a part of it. Picked
 * entries are the working list, the others wait in the pool and can be picked later.
 *
 * An import keeps what the team did: an entry found again (same category and name) gets the new
 * texts but keeps status, note and links; an entry the new atlas drops stays with in_atlas off.
 * Radios, podcasts and press become media companies, clubs and festivals become venues, for
 * picked entries only: an existing record of that name is used when exactly one matches, else a
 * new one is created when asked for.
 */
@injectable()
export class MarketingRepository {
  atlas(bandId: number) {
    return db
      .select()
      .from(schema.marketing_atlas)
      .where(eq(schema.marketing_atlas.band_id, bandId))
      .get()
  }

  items(bandId: number): MarketingItemRow[] {
    const rows = db
      .select({
        item: schema.marketing_item,
        companyName: schema.company.name,
        companyAddress: schema.company.address_id,
        venueName: schema.venue.name,
        venueAddress: schema.venue.address_id
      })
      .from(schema.marketing_item)
      .leftJoin(schema.company, eq(schema.company.id, schema.marketing_item.company_id))
      .leftJoin(schema.venue, eq(schema.venue.id, schema.marketing_item.venue_id))
      .where(eq(schema.marketing_item.band_id, bandId))
      .orderBy(asc(schema.marketing_item.priority), asc(schema.marketing_item.name))
      .all()
    const ids = [
      ...new Set(
        rows
          .map((row) => row.venueAddress ?? row.companyAddress)
          .filter((id): id is number => id !== null)
      )
    ]
    const addresses = new Map<number, typeof schema.address.$inferSelect>()
    for (let i = 0; i < ids.length; i += 400) {
      for (const address of db
        .select()
        .from(schema.address)
        .where(inArray(schema.address.id, ids.slice(i, i + 400)))
        .all())
        addresses.set(address.id, address)
    }
    return rows.map((row) => {
      const addressId = row.venueAddress ?? row.companyAddress
      return {
        ...row.item,
        companyName: row.companyName,
        venueName: row.venueName,
        location: locate(addressId === null ? null : (addresses.get(addressId) ?? null))
      }
    })
  }

  /**
   * Unlinked picked entries whose name several address-book records carry, by entry id: the
   * team picks the right one on the entry
   */
  candidatesOf(rows: ItemRow[]): Map<number, MarketingContactCandidateDto[]> {
    const open = rows.filter(
      (row) =>
        row.picked &&
        row.company_id === null &&
        row.venue_id === null &&
        contactKindOf(row.category as MarketingCategory) !== null
    )
    const result = new Map<number, MarketingContactCandidateDto[]>()
    if (open.length === 0) return result
    const book = new AddressBook(db as unknown as Tx)
    for (const row of open) {
      const kind = contactKindOf(row.category as MarketingCategory)!
      const found = book.find(rowAsItem(row), kind)
      if (found === 'ambiguous') result.set(row.id, book.candidates(rowAsItem(row), kind))
    }
    return result
  }

  bandName(bandId: number): string | null {
    return (
      db
        .select({ name: schema.band.name })
        .from(schema.band)
        .where(eq(schema.band.id, bandId))
        .get()?.name ?? null
    )
  }

  /** Entries that name the company or the club/festival, with their band */
  linksOf(target: { companyId?: number; venueId?: number }) {
    const where =
      target.companyId !== undefined
        ? eq(schema.marketing_item.company_id, target.companyId)
        : eq(schema.marketing_item.venue_id, target.venueId ?? -1)
    return db
      .select({
        id: schema.marketing_item.id,
        bandId: schema.marketing_item.band_id,
        bandName: schema.band.name,
        category: schema.marketing_item.category,
        priority: schema.marketing_item.priority,
        status: schema.marketing_item.status,
        statusNote: schema.marketing_item.status_note
      })
      .from(schema.marketing_item)
      .innerJoin(schema.band, eq(schema.band.id, schema.marketing_item.band_id))
      .where(and(where, eq(schema.marketing_item.picked, true)))
      .orderBy(asc(schema.band.name))
      .all()
  }

  update(input: UpdateMarketingItemInput): void {
    const values: Partial<typeof schema.marketing_item.$inferInsert> = {}
    if (input.status !== undefined) {
      values.status = input.status
      values.status_date = new Date().toISOString().slice(0, 10)
      // what the team works on is on the working list
      if (input.status !== 'open') values.picked = true
    }
    if (input.statusNote !== undefined) values.status_note = input.statusNote.trim()
    if (Object.keys(values).length === 0) return
    const changed = db
      .update(schema.marketing_item)
      .set({ ...values, updated_at: sql`datetime('now')` })
      .where(eq(schema.marketing_item.id, input.id))
      .run().changes
    if (changed === 0) throw new Error('Diesen Eintrag gibt es nicht mehr.')
  }

  /** One status for several entries of the band; they join the working list unless open */
  updateMany(bandId: number, ids: number[], status: MarketingStatus): number {
    return db
      .update(schema.marketing_item)
      .set({
        status,
        status_date: new Date().toISOString().slice(0, 10),
        ...(status !== 'open' ? { picked: true } : {}),
        updated_at: sql`datetime('now')`
      })
      .where(and(eq(schema.marketing_item.band_id, bandId), inArray(schema.marketing_item.id, ids)))
      .run().changes
  }

  /**
   * Links one entry to the address book: the record given (one of its candidates), or the one
   * found by email or name, or a new one
   */
  linkContact(id: number, target: { companyId?: number; venueId?: number } = {}): void {
    db.transaction((tx) => {
      const row = tx
        .select()
        .from(schema.marketing_item)
        .where(eq(schema.marketing_item.id, id))
        .get()
      if (!row) throw new Error('Diesen Eintrag gibt es nicht mehr.')
      const bandName = this.bandName(row.band_id) ?? ''
      const counts = { companies: 0, venues: 0, ambiguous: 0 }
      let link: Link | null
      if (target.companyId !== undefined) {
        const exists = tx
          .select({ id: schema.company.id })
          .from(schema.company)
          .where(eq(schema.company.id, target.companyId))
          .get()
        if (!exists) throw new Error('Diese Firma gibt es nicht mehr.')
        link = { company_id: target.companyId }
      } else if (target.venueId !== undefined) {
        const exists = tx
          .select({ id: schema.venue.id })
          .from(schema.venue)
          .where(eq(schema.venue.id, target.venueId))
          .get()
        if (!exists) throw new Error('Diesen Ort gibt es nicht mehr.')
        link = { venue_id: target.venueId }
      } else {
        link = this.contactFor(tx, new AddressBook(tx), rowAsItem(row), bandName, true, counts)
      }
      if (counts.ambiguous > 0)
        throw new Error('Mehrere Einträge im Adressbuch heißen so. Bitte am Eintrag einen wählen.')
      if (!link) throw new Error('Für diese Art Eintrag wird kein Kontakt angelegt.')
      tx.update(schema.marketing_item)
        .set({ ...link, picked: true, updated_at: sql`datetime('now')` })
        .where(eq(schema.marketing_item.id, id))
        .run()
    })
  }

  /**
   * The entries of a file before the import: which are new, and the suggested working list
   * (what is on it or was worked on stays; new entries with priority A or a running relationship
   * join)
   */
  preview(bandId: number, atlas: Atlas): MarketingFileEntryDto[] {
    return this.compare(bandId, atlas).entries
  }

  /**
   * A file against what is stored: its entries (new, changed, probably renamed, suggested for
   * the list), names standing twice, and the stored entries the file no longer lists
   */
  compare(
    bandId: number,
    atlas: Atlas
  ): Pick<MarketingFileDto, 'entries' | 'duplicates' | 'dropped'> {
    const rows = db
      .select()
      .from(schema.marketing_item)
      .where(eq(schema.marketing_item.band_id, bandId))
      .all()
    const stored = new Map(rows.map((row) => [row.item_key, row]))
    const seen = new Set<string>()
    const duplicates: string[] = []
    const unique: AtlasItem[] = []
    for (const item of atlas.items) {
      const key = itemKey(item)
      if (seen.has(key)) {
        duplicates.push(item.name)
        continue
      }
      seen.add(key)
      unique.push(item)
    }
    // entries of the file not stored yet, and stored ones the file lacks: maybe renamed
    const renames = findRenames(
      unique.filter((item) => !stored.has(itemKey(item))),
      rows.filter((row) => row.in_atlas && !seen.has(row.item_key)).map(rowAsItemWithKey)
    )
    const renamedFrom = new Set(renames.values())
    const entries: MarketingFileEntryDto[] = []
    for (const item of unique) {
      const key = itemKey(item)
      const oldKey = renames.get(key)
      const row = stored.get(key) ?? (oldKey ? stored.get(oldKey) : undefined)
      entries.push({
        key,
        category: item.category,
        group: item.group,
        name: item.name,
        country: item.country,
        type: item.type,
        priority: item.priority,
        quality: item.quality,
        reason: item.reason,
        isNew: stored.size > 0 && !row,
        picked: row
          ? row.picked || row.status !== 'open'
          : item.priority === 'A' || item.activeNote !== '',
        changed: !!row && !oldKey && textsDiffer(rowAsItem(row), item),
        renamedFrom: oldKey && row ? { key: oldKey, name: row.name } : null
      })
    }
    const dropped = rows
      .filter((row) => row.in_atlas && !seen.has(row.item_key) && !renamedFrom.has(row.item_key))
      .map((row) => ({
        name: row.name,
        category: row.category as MarketingCategory,
        status: row.status as MarketingStatus,
        picked: row.picked
      }))
    return { entries, duplicates: [...new Set(duplicates)], dropped }
  }

  /** Moves entries of the band between working list and pool; contacts for picked ones */
  setPicked(
    bandId: number,
    ids: number[],
    picked: boolean,
    createContacts: boolean
  ): { changed: number; contactsCreated: number } {
    if (ids.length === 0) return { changed: 0, contactsCreated: 0 }
    const bandName = this.bandName(bandId) ?? ''
    return db.transaction((tx) => {
      const rows = tx
        .select()
        .from(schema.marketing_item)
        .where(
          and(
            eq(schema.marketing_item.band_id, bandId),
            inArray(schema.marketing_item.id, ids),
            eq(schema.marketing_item.picked, !picked)
          )
        )
        .all()
      const counts = { companies: 0, venues: 0, ambiguous: 0 }
      const book = new AddressBook(tx)
      for (const row of rows) {
        const link =
          picked && row.company_id === null && row.venue_id === null
            ? this.contactFor(tx, book, rowAsItem(row), bandName, createContacts, counts)
            : null
        tx.update(schema.marketing_item)
          .set({ ...(link ?? {}), picked, updated_at: sql`datetime('now')` })
          .where(eq(schema.marketing_item.id, row.id))
          .run()
      }
      return { changed: rows.length, contactsCreated: counts.companies + counts.venues }
    })
  }

  importAtlas(
    bandId: number,
    atlas: Atlas,
    sourceName: string,
    options: {
      /** Keys of the working list; without it the suggestion of `preview` */
      picked?: string[]
      createContacts: boolean
      contactLists: boolean
      /** Key in the file → key of the stored entry it continues (a renamed entry) */
      renames?: Record<string, string>
    }
  ): MarketingImportResultDto {
    const bandName = this.bandName(bandId)
    if (bandName === null) throw new Error('Diese Band gibt es nicht mehr.')
    return db.transaction((tx) => {
      const result: MarketingImportResultDto = {
        created: 0,
        updated: 0,
        dropped: 0,
        picked: 0,
        companiesCreated: 0,
        venuesCreated: 0,
        linked: 0,
        lists: 0,
        ambiguous: 0,
        renamed: 0
      }
      this.saveUndo(tx, bandId)
      const head = {
        stand: atlas.stand,
        run: atlas.run,
        lead: atlas.lead,
        facts: JSON.stringify(atlas.facts),
        refs: JSON.stringify(atlas.refs),
        tabs: JSON.stringify(atlas.tabs),
        runs: JSON.stringify(atlas.runs),
        excluded: JSON.stringify(atlas.excluded),
        source_name: sourceName
      }
      const existingAtlas = tx
        .select({ id: schema.marketing_atlas.id })
        .from(schema.marketing_atlas)
        .where(eq(schema.marketing_atlas.band_id, bandId))
        .get()
      if (existingAtlas) {
        tx.update(schema.marketing_atlas)
          .set({ ...head, imported_at: sql`datetime('now')`, updated_at: sql`datetime('now')` })
          .where(eq(schema.marketing_atlas.id, existingAtlas.id))
          .run()
      } else {
        tx.insert(schema.marketing_atlas)
          .values({ band_id: bandId, ...head })
          .run()
      }

      const stored = new Map(
        tx
          .select()
          .from(schema.marketing_item)
          .where(eq(schema.marketing_item.band_id, bandId))
          .all()
          .map((row) => [row.item_key, row])
      )
      const seen = new Set<string>()
      const counts = { companies: 0, venues: 0, ambiguous: 0 }
      const book = new AddressBook(tx)
      const picks = new Set(
        options.picked ??
          this.preview(bandId, atlas)
            .filter((entry) => entry.picked)
            .map((entry) => entry.key)
      )
      for (const item of atlas.items) {
        const key = itemKey(item)
        if (seen.has(key)) continue
        seen.add(key)
        const texts = {
          category: item.category,
          group_name: item.group,
          name: item.name,
          country: item.country,
          type: item.type,
          priority: item.priority,
          reason: item.reason,
          approach: item.approach,
          timing: item.timing,
          quality: item.quality,
          source_url: item.url,
          contact_email: item.contact.email,
          contact_url: item.contact.url,
          contact_note: item.contact.note,
          active_note: item.activeNote,
          in_atlas: true
        }
        const picked = picks.has(key)
        if (picked) result.picked++
        // only the working list reaches the address book
        const contact = () =>
          picked ? this.contactFor(tx, book, item, bandName, options.createContacts, counts) : null
        const oldKey = options.renames?.[key]
        const renamed =
          !stored.has(key) && oldKey !== undefined && stored.has(oldKey) && !seen.has(oldKey)
        const row = stored.get(key) ?? (renamed && oldKey ? stored.get(oldKey) : undefined)
        if (renamed && oldKey) {
          // the stored entry continues under the new name; the old key is done
          seen.add(oldKey)
          result.renamed++
        }
        if (row) {
          const link = row.company_id === null && row.venue_id === null ? contact() : null
          if (link) result.linked++
          // an existing relationship the atlas names is a status, unless the team set one
          const status: MarketingStatus =
            row.status === 'open' && item.activeNote ? 'active' : (row.status as MarketingStatus)
          tx.update(schema.marketing_item)
            .set({
              ...texts,
              ...(link ?? {}),
              item_key: key,
              status,
              picked,
              updated_at: sql`datetime('now')`
            })
            .where(eq(schema.marketing_item.id, row.id))
            .run()
          result.updated++
        } else {
          const link = contact()
          if (link) result.linked++
          tx.insert(schema.marketing_item)
            .values({
              band_id: bandId,
              item_key: key,
              ...texts,
              ...(link ?? {}),
              picked,
              status: item.activeNote ? 'active' : 'open'
            })
            .run()
          result.created++
        }
      }
      for (const [key, row] of stored) {
        if (seen.has(key) || !row.in_atlas) continue
        tx.update(schema.marketing_item)
          .set({ in_atlas: false, updated_at: sql`datetime('now')` })
          .where(eq(schema.marketing_item.id, row.id))
          .run()
        result.dropped++
      }
      result.companiesCreated = counts.companies
      result.venuesCreated = counts.venues
      result.ambiguous = counts.ambiguous
      if (options.contactLists) result.lists = this.fillLists(tx, bandId, bandName)
      return result
    })
  }

  /**
   * The company or venue of an entry: the one record found by email or name, else a new one
   * when `create` is set; null for entries that are no contact and when several records fit
   * (counted as ambiguous)
   */
  private contactFor(
    tx: Tx,
    book: AddressBook,
    item: AtlasItem,
    bandName: string,
    create: boolean,
    counts: Counts
  ): Link | null {
    const kind = contactKindOf(item.category)
    if (!kind) return null
    const found = book.find(item, kind)
    if (found === 'ambiguous') {
      counts.ambiguous++
      return null
    }
    if (found || !create) return found
    let link: Link
    if (kind === 'media') {
      const created = tx
        .insert(schema.company)
        .values({
          name: item.name,
          kind: 'media',
          notes: contactNotes(item, bandName),
          address_id: this.countryAddress(tx, item.country),
          contact_id: this.contactRow(tx, item)
        })
        .returning({ id: schema.company.id })
        .get()
      counts.companies++
      link = { company_id: created.id }
    } else {
      const created = tx
        .insert(schema.venue)
        .values({
          name: item.name,
          kind,
          notes: contactNotes(item, bandName),
          address_id: this.countryAddress(tx, item.country),
          contact_id: this.contactRow(tx, item)
        })
        .returning({ id: schema.venue.id })
        .get()
      counts.venues++
      link = { venue_id: created.id }
    }
    book.added(link, item, kind)
    return link
  }

  /** Keeps the band's atlas and entries as they are now, for "Letzten Import zurücknehmen" */
  private saveUndo(tx: Tx, bandId: number): void {
    const snapshot: UndoSnapshot = {
      atlas:
        tx
          .select()
          .from(schema.marketing_atlas)
          .where(eq(schema.marketing_atlas.band_id, bandId))
          .get() ?? null,
      items: tx
        .select()
        .from(schema.marketing_item)
        .where(eq(schema.marketing_item.band_id, bandId))
        .all()
    }
    const text = JSON.stringify(snapshot)
    tx.insert(schema.marketing_import_undo)
      .values({ band_id: bandId, snapshot: text })
      .onConflictDoUpdate({
        target: schema.marketing_import_undo.band_id,
        set: { snapshot: text, created_at: sql`datetime('now')` }
      })
      .run()
  }

  /** When the band's last import ran, if it can still be taken back on this computer */
  undoInfo(bandId: number): { importedAt: string } | null {
    const row = db
      .select({ createdAt: schema.marketing_import_undo.created_at })
      .from(schema.marketing_import_undo)
      .where(eq(schema.marketing_import_undo.band_id, bandId))
      .get()
    return row ? { importedAt: row.createdAt } : null
  }

  /**
   * Takes the last import back: head data and entries as before it; entries it created are
   * removed (their measures stay, without the entry). Contacts and lists it created stay.
   */
  undoImport(bandId: number): { restored: number; removed: number } {
    return db.transaction((tx) => {
      const row = tx
        .select()
        .from(schema.marketing_import_undo)
        .where(eq(schema.marketing_import_undo.band_id, bandId))
        .get()
      if (!row) throw new Error('Es gibt keinen Import, der sich zurücknehmen lässt.')
      const snapshot = JSON.parse(row.snapshot) as UndoSnapshot
      const keep = snapshot.items.map((item) => item.id)
      const removed = tx
        .delete(schema.marketing_item)
        .where(
          keep.length > 0
            ? and(
                eq(schema.marketing_item.band_id, bandId),
                notInArray(schema.marketing_item.id, keep)
              )
            : eq(schema.marketing_item.band_id, bandId)
        )
        .run().changes
      for (const item of snapshot.items) {
        const { id, ...values } = item
        const changed = tx
          .update(schema.marketing_item)
          .set({ ...values, updated_at: sql`datetime('now')` })
          .where(eq(schema.marketing_item.id, id))
          .run().changes
        if (changed === 0) tx.insert(schema.marketing_item).values(item).run()
      }
      if (snapshot.atlas) {
        const { id, ...head } = snapshot.atlas
        tx.update(schema.marketing_atlas)
          .set({ ...head, updated_at: sql`datetime('now')` })
          .where(eq(schema.marketing_atlas.id, id))
          .run()
      } else {
        tx.delete(schema.marketing_atlas).where(eq(schema.marketing_atlas.band_id, bandId)).run()
      }
      tx.delete(schema.marketing_import_undo)
        .where(eq(schema.marketing_import_undo.band_id, bandId))
        .run()
      return { restored: snapshot.items.length, removed }
    })
  }

  /** An address that only names the country, when the atlas gives a country code */
  private countryAddress(tx: Tx, code: string): number | null {
    const upper = code.toUpperCase()
    // the atlases write UK; ISO says GB
    const country = countryByCode(upper === 'UK' ? 'GB' : upper)
    if (!country) return null
    return tx
      .insert(schema.address)
      .values({ country: country.name, country_code: country.code })
      .returning({ id: schema.address.id })
      .get().id
  }

  private contactRow(tx: Tx, item: AtlasItem): number | null {
    if (!item.contact.email && !item.contact.url) return null
    return tx
      .insert(schema.contact)
      .values({ email: item.contact.email.toLowerCase(), homepage: item.contact.url || null })
      .returning({ id: schema.contact.id })
      .get().id
  }

  /** One member list per tab: "Marketing-Atlas <Band> – Radios" with the linked picked contacts */
  private fillLists(tx: Tx, bandId: number, bandName: string): number {
    const rows = tx
      .select()
      .from(schema.marketing_item)
      .where(
        and(
          eq(schema.marketing_item.band_id, bandId),
          eq(schema.marketing_item.in_atlas, true),
          eq(schema.marketing_item.picked, true)
        )
      )
      .all()
    const byCategory = new Map<string, ItemRow[]>()
    for (const row of rows) {
      if (row.company_id === null && row.venue_id === null) continue
      byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row])
    }
    let lists = 0
    for (const [category, members] of byCategory) {
      const name = `Marketing-Atlas ${bandName} – ${MARKETING_CATEGORY_LABELS[category as MarketingCategory]}`
      const list =
        tx
          .select({ id: schema.contact_list.id })
          .from(schema.contact_list)
          .where(and(eq(schema.contact_list.name, name), eq(schema.contact_list.kind, 'members')))
          .get() ??
        tx
          .insert(schema.contact_list)
          .values({ name, kind: 'members' })
          .returning({ id: schema.contact_list.id })
          .get()
      for (const member of members) {
        tx.insert(schema.contact_list_member)
          .values({
            contact_list_id: list.id,
            company_id: member.company_id,
            venue_id: member.company_id === null ? member.venue_id : null
          })
          .onConflictDoNothing()
          .run()
      }
      lists++
    }
    return lists
  }
}

/** What a created contact carries from the atlas */
function contactNotes(item: AtlasItem, bandName: string): string {
  return [
    `Aus dem Marketing-Atlas ${bandName} (${MARKETING_CATEGORY_LABELS[item.category]}, Priorität ${item.priority}).`,
    item.type && `Art: ${item.type}`,
    item.approach && `Weg: ${item.approach}`,
    item.contact.note && `Kontakt: ${item.contact.note}`,
    item.url && `Quelle: ${item.url}`
  ]
    .filter(Boolean)
    .join('\n')
}

function rowAsItemWithKey(row: ItemRow): AtlasItem & { key: string } {
  return { ...rowAsItem(row), key: row.item_key }
}

function rowAsItem(row: ItemRow): AtlasItem {
  return {
    category: row.category as MarketingCategory,
    group: row.group_name,
    name: row.name,
    country: row.country,
    type: row.type,
    priority: row.priority as AtlasItem['priority'],
    reason: row.reason,
    approach: row.approach,
    timing: row.timing,
    quality: row.quality as AtlasItem['quality'],
    url: row.source_url,
    contact: { email: row.contact_email, url: row.contact_url, note: row.contact_note },
    activeNote: row.active_note
  }
}
