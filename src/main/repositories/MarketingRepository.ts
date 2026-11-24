import { injectable } from 'tsyringe'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { Tx } from './tx'
import { companyKey, countryByCode, normalizeKey } from '../import/normalize'
import { contactKindOf, itemKey, type Atlas, type AtlasItem } from '../marketing/atlasFormat'
import {
  MARKETING_CATEGORY_LABELS,
  type MarketingCategory,
  type MarketingFileEntryDto,
  type MarketingImportResultDto,
  type MarketingStatus,
  type UpdateMarketingItemInput
} from '../api/schemas/marketing.schema'

type ItemRow = typeof schema.marketing_item.$inferSelect

export type MarketingItemRow = ItemRow & { companyName: string | null; venueName: string | null }

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
    return db
      .select({
        item: schema.marketing_item,
        companyName: schema.company.name,
        venueName: schema.venue.name
      })
      .from(schema.marketing_item)
      .leftJoin(schema.company, eq(schema.company.id, schema.marketing_item.company_id))
      .leftJoin(schema.venue, eq(schema.venue.id, schema.marketing_item.venue_id))
      .where(eq(schema.marketing_item.band_id, bandId))
      .orderBy(asc(schema.marketing_item.priority), asc(schema.marketing_item.name))
      .all()
      .map((row) => ({ ...row.item, companyName: row.companyName, venueName: row.venueName }))
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

  /** Creates (or finds) the address-book record of one entry and links it */
  linkContact(id: number): void {
    db.transaction((tx) => {
      const row = tx
        .select()
        .from(schema.marketing_item)
        .where(eq(schema.marketing_item.id, id))
        .get()
      if (!row) throw new Error('Diesen Eintrag gibt es nicht mehr.')
      const bandName = this.bandName(row.band_id) ?? ''
      const counts = { companies: 0, venues: 0 }
      const link = this.contactFor(tx, rowAsItem(row), bandName, true, counts)
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
    const stored = new Map(
      db
        .select({
          key: schema.marketing_item.item_key,
          picked: schema.marketing_item.picked,
          status: schema.marketing_item.status
        })
        .from(schema.marketing_item)
        .where(eq(schema.marketing_item.band_id, bandId))
        .all()
        .map((row) => [row.key, row])
    )
    const seen = new Set<string>()
    const entries: MarketingFileEntryDto[] = []
    for (const item of atlas.items) {
      const key = itemKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      const row = stored.get(key)
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
          : item.priority === 'A' || item.activeNote !== ''
      })
    }
    return entries
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
      const counts = { companies: 0, venues: 0 }
      for (const row of rows) {
        const link =
          picked && row.company_id === null && row.venue_id === null
            ? this.contactFor(tx, rowAsItem(row), bandName, createContacts, counts)
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
        lists: 0
      }
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
      const counts = { companies: 0, venues: 0 }
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
          picked ? this.contactFor(tx, item, bandName, options.createContacts, counts) : null
        const row = stored.get(key)
        if (row) {
          const link = row.company_id === null && row.venue_id === null ? contact() : null
          if (link) result.linked++
          // an existing relationship the atlas names is a status, unless the team set one
          const status: MarketingStatus =
            row.status === 'open' && item.activeNote ? 'active' : (row.status as MarketingStatus)
          tx.update(schema.marketing_item)
            .set({ ...texts, ...(link ?? {}), status, picked, updated_at: sql`datetime('now')` })
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
      if (options.contactLists) result.lists = this.fillLists(tx, bandId, bandName)
      return result
    })
  }

  /**
   * The company or venue of an entry: an existing one of that name when exactly one matches,
   * else a new one when `create` is set; null for entries that are no contact
   */
  private contactFor(
    tx: Tx,
    item: AtlasItem,
    bandName: string,
    create: boolean,
    counts: { companies: number; venues: number }
  ): { company_id: number } | { venue_id: number } | null {
    const kind = contactKindOf(item.category)
    if (!kind) return null
    if (kind === 'media') {
      const key = companyKey(item.name)
      const matches = tx
        .select({ id: schema.company.id, name: schema.company.name })
        .from(schema.company)
        .all()
        .filter((c) => companyKey(c.name) === key)
      if (matches.length === 1) return { company_id: matches[0].id }
      if (matches.length > 1 || !create) return null
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
      return { company_id: created.id }
    }
    const key = normalizeKey(item.name)
    const matches = tx
      .select({ id: schema.venue.id, name: schema.venue.name })
      .from(schema.venue)
      .all()
      .filter((v) => normalizeKey(v.name) === key)
    if (matches.length === 1) return { venue_id: matches[0].id }
    if (matches.length > 1 || !create) return null
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
    return { venue_id: created.id }
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
