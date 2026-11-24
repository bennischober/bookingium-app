import { and, eq, max, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import type { Tx } from './tx'
import type { ImportContactList, ImportResult } from '../api/schemas/import.schema'
import type {
  AddressDraft,
  ContactDraft,
  ExistingRecords,
  ImportPlan,
  ListMemberDraft
} from '../import/plan/drafts'
import { contactAddressEvents, normalizeEmail } from './contactEmails'
import { genresByOwner, writeGenres, type GenreOwner } from './genres'
import { assertActiveEmployee, shareRecords } from './staffGrants'

type AddressRow = typeof schema.address.$inferSelect
type ContactRow = typeof schema.contact.$inferSelect

const hasValues = (values: object): boolean =>
  Object.values(values).some((value) => value !== '' && value !== null && value !== undefined)

/** #248: German names of the columns an import fills, for the preview */
const FIELD_LABELS: Record<string, string> = {
  email: 'E-Mail',
  phone: 'Telefon',
  mobile_phone: 'Mobil',
  homepage: 'Webseite',
  street: 'Straße',
  street_number: 'Hausnummer',
  zip_code: 'PLZ',
  city: 'Ort',
  state: 'Bundesland',
  country: 'Land',
  notes: 'Anmerkungen',
  birthday: 'Geburtstag',
  capacity: 'Kapazität',
  vat_id: 'USt-IdNr.',
  tax_number: 'Steuernummer',
  founded: 'Gegründet',
  company_id: 'Veranstalter'
}

/**
 * #248: the running write. `overwrite` lets a value of the file replace a different stored one
 * (notes are added, never replaced); `current` is the record being written, and `changes`
 * collects which fields each existing record got, for the preview's dry run.
 */
let session: {
  overwrite: boolean
  current: string | null
  changes: Map<string, Set<string>>
} | null = null

function note(column: string): void {
  const label = FIELD_LABELS[column]
  if (!session?.current || !label) return
  const fields = session.changes.get(session.current) ?? new Set<string>()
  fields.add(label)
  session.changes.set(session.current, fields)
}

const blank = (value: unknown): boolean => value === null || value === undefined || value === ''

/**
 * The draft values for the columns that are still empty in `row`; with "überschreiben" also
 * those that differ (ids and the country code only fill)
 */
function emptyOnly<T extends Record<string, unknown>>(row: T, values: Partial<T>): Partial<T> {
  const changes: Partial<T> = {}
  for (const [column, value] of Object.entries(values) as Array<[keyof T, T[keyof T]]>) {
    if (blank(value)) continue
    const current = row[column]
    const name = String(column)
    if (blank(current)) {
      changes[column] = value
      note(name)
    } else if (session?.overwrite && !name.endsWith('_id') && name !== 'country_code') {
      if (name === 'notes') {
        if (!String(current).includes(String(value))) {
          changes[column] = `${current}\n${value}` as T[keyof T]
          note(name)
        }
      } else if (String(current) !== String(value)) {
        changes[column] = value
        note(name)
      }
    }
  }
  return changes
}

/** Thrown at the end of a dry run so the transaction rolls back */
class DryRunDone extends Error {}

/** Like emptyOnly for genre tags: sets them only on a record that has none; true if it did */
function fillGenres(tx: Tx, owner: GenreOwner, id: number, value: string): boolean {
  if (!value.trim() || genresByOwner(owner, [id], tx).has(id)) return false
  writeGenres(tx, owner, id, value)
  return genresByOwner(owner, [id], tx).has(id)
}

function addressValues(draft: AddressDraft): Partial<AddressRow> {
  return {
    street: draft.street,
    street_number: draft.streetNumber,
    zip_code: draft.zipCode,
    city: draft.city,
    state: draft.state,
    country: draft.country,
    country_code: draft.countryCode
  }
}

function contactValues(draft: ContactDraft): Partial<ContactRow> {
  return {
    email: draft.email,
    phone: draft.phone,
    mobile_phone: draft.mobilePhone,
    homepage: draft.homepage
  }
}

@injectable()
export class ImportRepository {
  /** Names the import matches against */
  loadExisting(): ExistingRecords {
    const venues = db
      .select({ id: schema.venue.id, name: schema.venue.name, city: schema.address.city })
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .all()
      .map((venue) => ({ ...venue, city: venue.city ?? '' }))
    // #248: every address of a contact (main one and further ones), for matching by email
    const emailsByContact = new Map<number, string[]>()
    const addEmail = (contactId: number | null, email: string | null) => {
      if (contactId === null || !email?.trim()) return
      emailsByContact.set(contactId, [...(emailsByContact.get(contactId) ?? []), email])
    }
    for (const row of db
      .select({ id: schema.contact.id, email: schema.contact.email })
      .from(schema.contact)
      .all())
      addEmail(row.id, row.email)
    for (const row of db
      .select({ id: schema.contact_email.contact_id, email: schema.contact_email.email })
      .from(schema.contact_email)
      .all())
      addEmail(row.id, row.email)
    const companies = db
      .select({ id: schema.company.id, name: schema.company.name })
      .from(schema.company)
      .all()
    const persons = db
      .select({
        id: schema.person.id,
        firstName: schema.person.first_name,
        lastName: schema.person.last_name,
        contactId: schema.person.contact_id
      })
      .from(schema.person)
      .all()
      .map(({ contactId, ...person }) => ({
        ...person,
        emails: contactId === null ? [] : (emailsByContact.get(contactId) ?? [])
      }))
    const bands = db.select({ id: schema.band.id, name: schema.band.name }).from(schema.band).all()
    return { venues, bands, companies, persons }
  }

  /**
   * Writes the plan in one transaction: new records are created, existing
   * ones only get their empty fields filled, and links (venue → company,
   * contact persons, band members) are added where missing. With a
   * contactList, the records that took an address of the file go into that
   * member list (#154), in the same transaction.
   */
  apply(
    plan: ImportPlan,
    contactList: ImportContactList | null = null,
    overwrite = false,
    shareWith: number | null = null
  ): ImportResult {
    session = { overwrite, current: null, changes: new Map() }
    let result: ImportResult
    try {
      result = this.write(plan, contactList, false, shareWith)
    } finally {
      session = null
    }
    // The mail linker looks for mail of the imported addresses (after the commit)
    const outcomes = [result.venues, result.bands, result.companies, result.persons]
    if (outcomes.some((outcome) => outcome.created + outcome.updated > 0)) {
      contactAddressEvents.emit('saved')
    }
    return result
  }

  /**
   * #248: writes the plan and rolls it back; returns per existing record ("person:id:5") the
   * fields the import would fill (or overwrite)
   */
  dryRun(plan: ImportPlan, overwrite = false): Map<string, string[]> {
    session = { overwrite, current: null, changes: new Map() }
    const changes = session.changes
    try {
      this.write(plan, null, true)
    } catch (error) {
      if (!(error instanceof DryRunDone)) throw error
    } finally {
      session = null
    }
    return new Map([...changes].map(([key, fields]) => [key, [...fields]]))
  }

  private write(
    plan: ImportPlan,
    contactList: ImportContactList | null,
    dryRun = false,
    shareWith: number | null = null
  ): ImportResult {
    return db.transaction((tx) => {
      const outcome = () => ({ created: 0, updated: 0 })
      const result: ImportResult = {
        venues: outcome(),
        bands: outcome(),
        companies: outcome(),
        persons: outcome(),
        contactList: null
      }

      // ---- Persons ----
      const personIds = new Map<string, number>()
      for (const draft of plan.persons) {
        const notes = draft.notes.join('\n')
        if (draft.existingId === null) {
          const created = tx
            .insert(schema.person)
            .values({
              first_name: draft.firstName,
              last_name: draft.lastName,
              birthday: draft.birthday || null,
              notes: notes || null,
              address_id: this.insertAddress(tx, draft.address),
              contact_id: this.insertContact(tx, draft.contact)
            })
            .returning({ id: schema.person.id })
            .get()
          personIds.set(draft.key, created.id)
          result.persons.created++
          continue
        }
        const row = tx
          .select()
          .from(schema.person)
          .where(eq(schema.person.id, draft.existingId))
          .get()
        if (!row) throw new Error(`Person ${draft.existingId} nicht gefunden`)
        if (session) session.current = `person:${draft.key}`
        personIds.set(draft.key, row.id)
        const address = this.completeAddress(tx, row.address_id, draft.address)
        const contact = this.completeContact(tx, row.contact_id, draft.contact)
        const changes = emptyOnly(row, {
          notes,
          birthday: draft.birthday,
          address_id: address.id,
          contact_id: contact.id
        })
        if (hasValues(changes)) {
          tx.update(schema.person)
            .set({ ...changes, updated_at: sql`datetime('now')` })
            .where(eq(schema.person.id, row.id))
            .run()
        }
        if (address.changed || contact.changed || hasValues(changes)) result.persons.updated++
      }

      // ---- Companies ----
      const companyIds = new Map<string, number>()
      for (const draft of plan.companies) {
        const notes = draft.notes.join('\n')
        if (draft.existingId === null) {
          const created = tx
            .insert(schema.company)
            .values({
              name: draft.name,
              kind: draft.kind,
              notes: notes || null,
              vat_id: draft.vatId,
              tax_number: draft.taxNumber,
              address_id: this.insertAddress(tx, draft.address),
              contact_id: this.insertContact(tx, draft.contact)
            })
            .returning({ id: schema.company.id })
            .get()
          companyIds.set(draft.key, created.id)
          writeGenres(tx, 'company', created.id, draft.genres)
          this.addCompanyMembers(tx, created.id, draft.members, personIds)
          result.companies.created++
          continue
        }
        const row = tx
          .select()
          .from(schema.company)
          .where(eq(schema.company.id, draft.existingId))
          .get()
        if (!row) throw new Error(`Firma ${draft.existingId} nicht gefunden`)
        if (session) session.current = `company:${draft.key}`
        companyIds.set(draft.key, row.id)
        const address = this.completeAddress(tx, row.address_id, draft.address)
        const contact = this.completeContact(tx, row.contact_id, draft.contact)
        const changes = emptyOnly(row, {
          notes,
          vat_id: draft.vatId,
          tax_number: draft.taxNumber,
          address_id: address.id,
          contact_id: contact.id
        })
        if (hasValues(changes)) {
          tx.update(schema.company)
            .set({ ...changes, updated_at: sql`datetime('now')` })
            .where(eq(schema.company.id, row.id))
            .run()
        }
        const genresAdded = fillGenres(tx, 'company', row.id, draft.genres)
        const membersAdded = this.addCompanyMembers(tx, row.id, draft.members, personIds)
        if (
          address.changed ||
          contact.changed ||
          hasValues(changes) ||
          genresAdded ||
          membersAdded > 0
        ) {
          result.companies.updated++
        }
      }

      // ---- Bands (their company already exists) ----
      for (const draft of plan.bands) {
        const notes = draft.notes.join('\n')
        const responsibleId = draft.responsiblePersonKey
          ? (personIds.get(draft.responsiblePersonKey) ?? null)
          : null
        if (draft.existingId === null) {
          const created = tx
            .insert(schema.band)
            .values({
              name: draft.name,
              founded: draft.founded || null,
              notes,
              company_id: draft.companyId,
              management_company_id: draft.managementCompanyId,
              responsible_person_id: responsibleId
            })
            .returning({ id: schema.band.id })
            .get()
          writeGenres(tx, 'band', created.id, draft.genre)
          this.addBandMembers(tx, created.id, draft.members, personIds)
          result.bands.created++
          continue
        }
        const row = tx.select().from(schema.band).where(eq(schema.band.id, draft.existingId)).get()
        if (!row) throw new Error(`Band ${draft.existingId} nicht gefunden`)
        if (session) session.current = `band:${draft.key}`
        const changes = emptyOnly(row, {
          founded: draft.founded,
          notes,
          management_company_id: draft.managementCompanyId,
          responsible_person_id: responsibleId
        })
        if (hasValues(changes)) {
          tx.update(schema.band)
            .set({ ...changes, updated_at: sql`datetime('now')` })
            .where(eq(schema.band.id, row.id))
            .run()
        }
        const genresAdded = fillGenres(tx, 'band', row.id, draft.genre)
        const membersAdded = this.addBandMembers(tx, row.id, draft.members, personIds)
        if (hasValues(changes) || genresAdded || membersAdded > 0) result.bands.updated++
      }

      // ---- Venues ----
      const venueIds = new Map<string, number>()
      for (const draft of plan.venues) {
        const notes = draft.notes.join('\n')
        const companyId = draft.companyKey ? (companyIds.get(draft.companyKey) ?? null) : null
        if (draft.existingId === null) {
          const created = tx
            .insert(schema.venue)
            .values({
              name: draft.name,
              kind: draft.kind,
              capacity: draft.capacity,
              capacity_min: draft.capacityMin,
              notes,
              company_id: companyId,
              address_id: this.insertAddress(tx, draft.address),
              contact_id: this.insertContact(tx, draft.contact)
            })
            .returning({ id: schema.venue.id })
            .get()
          venueIds.set(draft.key, created.id)
          writeGenres(tx, 'venue', created.id, draft.genres)
          this.addVenueMembers(tx, created.id, draft.members, personIds)
          result.venues.created++
          continue
        }
        const row = tx
          .select()
          .from(schema.venue)
          .where(eq(schema.venue.id, draft.existingId))
          .get()
        if (!row) throw new Error(`Club / Festival ${draft.existingId} nicht gefunden`)
        if (session) session.current = `venue:${draft.key}`
        venueIds.set(draft.key, row.id)
        const address = this.completeAddress(tx, row.address_id, draft.address)
        const contact = this.completeContact(tx, row.contact_id, draft.contact)
        const changes = emptyOnly(row, {
          notes,
          capacity: draft.capacity,
          // a range goes in only together with its upper end, never under a stored number
          ...(row.capacity === null ? { capacity_min: draft.capacityMin } : {}),
          company_id: companyId,
          address_id: address.id,
          contact_id: contact.id
        })
        if (hasValues(changes)) {
          tx.update(schema.venue)
            .set({ ...changes, updated_at: sql`datetime('now')` })
            .where(eq(schema.venue.id, row.id))
            .run()
        }
        const genresAdded = fillGenres(tx, 'venue', row.id, draft.genres)
        const membersAdded = this.addVenueMembers(tx, row.id, draft.members, personIds)
        if (
          address.changed ||
          contact.changed ||
          hasValues(changes) ||
          genresAdded ||
          membersAdded > 0
        ) {
          result.venues.updated++
        }
      }

      if (contactList) {
        result.contactList = this.fillContactList(tx, contactList, plan.listMembers, {
          person: personIds,
          company: companyIds,
          venue: venueIds
        })
      }
      if (shareWith !== null) {
        // #262: every person, company and club/festival of the list, found or created
        assertActiveEmployee(tx, shareWith)
        result.shared =
          shareRecords(tx, shareWith, 'person', personIds.values()) +
          shareRecords(tx, shareWith, 'company', companyIds.values()) +
          shareRecords(tx, shareWith, 'venue', venueIds.values())
      }
      if (dryRun) throw new DryRunDone()
      return result
    })
  }

  /** Creates the member list or checks the chosen one, then adds the records */
  private fillContactList(
    tx: Tx,
    target: ImportContactList,
    members: ListMemberDraft[],
    ids: Record<ListMemberDraft['type'], Map<string, number>>
  ): NonNullable<ImportResult['contactList']> {
    let list: { id: number; name: string }
    if (target.id !== null) {
      const row = tx
        .select()
        .from(schema.contact_list)
        .where(eq(schema.contact_list.id, target.id))
        .get()
      if (!row) throw new Error('Der gewählte Verteiler existiert nicht mehr.')
      if (row.kind !== 'members') {
        throw new Error(`„${row.name}“ ist ein Filter-Verteiler und nimmt keine Kontakte auf.`)
      }
      list = row
    } else {
      if (!target.name) throw new Error('Geben Sie dem Verteiler einen Namen.')
      list = tx
        .insert(schema.contact_list)
        .values({ name: target.name, kind: 'members' })
        .returning({ id: schema.contact_list.id, name: schema.contact_list.name })
        .get()
    }

    let added = 0
    for (const member of members) {
      const id = ids[member.type].get(member.key)
      if (id === undefined) continue
      added += tx
        .insert(schema.contact_list_member)
        .values({
          contact_list_id: list.id,
          person_id: member.type === 'person' ? id : null,
          company_id: member.type === 'company' ? id : null,
          venue_id: member.type === 'venue' ? id : null
        })
        // Already on the list
        .onConflictDoNothing()
        .run().changes
    }
    if (target.id !== null && added > 0) {
      tx.update(schema.contact_list)
        .set({ updated_at: sql`datetime('now')` })
        .where(eq(schema.contact_list.id, list.id))
        .run()
    }
    return { id: list.id, name: list.name, added }
  }

  private insertAddress(tx: Tx, draft: AddressDraft): number | null {
    const values = addressValues(draft)
    if (!hasValues(values)) return null
    return tx.insert(schema.address).values(values).returning({ id: schema.address.id }).get().id
  }

  private insertContact(tx: Tx, draft: ContactDraft): number | null {
    const values = contactValues(draft)
    if (!hasValues(values)) return null
    const id = tx
      .insert(schema.contact)
      .values(values)
      .returning({ id: schema.contact.id })
      .get().id
    this.addOtherEmails(tx, id, draft.email, draft.emails)
    return id
  }

  /**
   * Adds further addresses a contact does not have yet (after the ones it
   * has); returns how many were added
   */
  private addOtherEmails(tx: Tx, contactId: number, primary: string, emails: string[]): number {
    const known = new Set([
      normalizeEmail(primary),
      ...tx
        .select({ email: schema.contact_email.email })
        .from(schema.contact_email)
        .where(eq(schema.contact_email.contact_id, contactId))
        .all()
        .map((row) => row.email)
    ])
    const added: string[] = []
    for (const address of emails) {
      const email = normalizeEmail(address)
      if (!email || known.has(email)) continue
      known.add(email)
      added.push(email)
    }
    if (added.length === 0) return 0
    const last = tx
      .select({ position: max(schema.contact_email.position) })
      .from(schema.contact_email)
      .where(eq(schema.contact_email.contact_id, contactId))
      .get()?.position
    const start = last === null || last === undefined ? 0 : last + 1
    tx.insert(schema.contact_email)
      .values(
        added.map((email, index) => ({ contact_id: contactId, email, position: start + index }))
      )
      .run()
    return added.length
  }

  /** Fills the empty fields of an existing address, or creates one */
  private completeAddress(
    tx: Tx,
    addressId: number | null,
    draft: AddressDraft
  ): { id: number | null; changed: boolean } {
    if (addressId === null) {
      const id = this.insertAddress(tx, draft)
      if (id !== null) note('street')
      return { id, changed: id !== null }
    }
    const row = tx.select().from(schema.address).where(eq(schema.address.id, addressId)).get()
    if (!row) return { id: addressId, changed: false }
    const changes = emptyOnly(row, addressValues(draft))
    if (!hasValues(changes)) return { id: addressId, changed: false }
    tx.update(schema.address).set(changes).where(eq(schema.address.id, addressId)).run()
    return { id: addressId, changed: true }
  }

  /** Fills the empty fields of an existing contact, or creates one */
  private completeContact(
    tx: Tx,
    contactId: number | null,
    draft: ContactDraft
  ): { id: number | null; changed: boolean } {
    if (contactId === null) {
      const id = this.insertContact(tx, draft)
      if (id !== null) note(draft.email ? 'email' : 'phone')
      return { id, changed: id !== null }
    }
    const row = tx.select().from(schema.contact).where(eq(schema.contact.id, contactId)).get()
    if (!row) return { id: contactId, changed: false }
    const changes = emptyOnly(row, contactValues(draft))
    if (hasValues(changes)) {
      tx.update(schema.contact).set(changes).where(eq(schema.contact.id, contactId)).run()
    }
    // A primary address other than the stored one becomes a further address
    const primary = row.email || draft.email
    const added = this.addOtherEmails(tx, contactId, primary, [draft.email, ...draft.emails])
    return { id: contactId, changed: hasValues(changes) || added > 0 }
  }

  /** Adds missing company members; returns how many were added */
  private addCompanyMembers(
    tx: Tx,
    companyId: number,
    members: Map<string, string>,
    personIds: Map<string, number>
  ): number {
    let added = 0
    for (const [personKey, role] of members) {
      const personId = personIds.get(personKey)
      if (personId === undefined) continue
      const inserted = tx
        .insert(schema.company_member)
        .values({ company_id: companyId, person_id: personId, role: role || null })
        .onConflictDoNothing()
        .returning({ id: schema.company_member.id })
        .all()
      added += inserted.length
    }
    return added
  }

  /** Adds missing band members; returns how many were added */
  private addBandMembers(
    tx: Tx,
    bandId: number,
    members: Map<string, string>,
    personIds: Map<string, number>
  ): number {
    let added = 0
    for (const [personKey, role] of members) {
      const personId = personIds.get(personKey)
      if (personId === undefined) continue
      added += tx
        .insert(schema.band_member)
        .values({ band_id: bandId, person_id: personId, role: role || null })
        .onConflictDoNothing()
        .returning({ id: schema.band_member.id })
        .all().length
    }
    return added
  }

  /** Adds missing venue contacts; returns how many were added */
  private addVenueMembers(
    tx: Tx,
    venueId: number,
    members: Map<string, string>,
    personIds: Map<string, number>
  ): number {
    let added = 0
    for (const [personKey, role] of members) {
      const personId = personIds.get(personKey)
      if (personId === undefined) continue
      const exists = tx
        .select({ id: schema.venue_member.id })
        .from(schema.venue_member)
        .where(
          and(
            eq(schema.venue_member.venue_id, venueId),
            eq(schema.venue_member.person_id, personId)
          )
        )
        .get()
      if (exists) continue
      tx.insert(schema.venue_member).values({ venue_id: venueId, person_id: personId, role }).run()
      added++
    }
    return added
  }
}
