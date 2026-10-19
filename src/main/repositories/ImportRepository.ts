import { and, eq, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import type { ImportResult } from '../api/schemas/import.schema'
import type {
  AddressDraft,
  ContactDraft,
  ExistingRecords,
  ImportPlan
} from '../import/buildImportPlan'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type AddressRow = typeof schema.address.$inferSelect
type ContactRow = typeof schema.contact.$inferSelect

const hasValues = (values: object): boolean =>
  Object.values(values).some((value) => value !== '' && value !== null && value !== undefined)

/** The draft values for the columns that are still empty in `row` */
function emptyOnly<T extends Record<string, unknown>>(row: T, values: Partial<T>): Partial<T> {
  const changes: Partial<T> = {}
  for (const [column, value] of Object.entries(values) as Array<[keyof T, T[keyof T]]>) {
    const current = row[column]
    const isEmpty = current === null || current === undefined || current === ''
    if (isEmpty && value !== '' && value !== null && value !== undefined) changes[column] = value
  }
  return changes
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
    const companies = db
      .select({ id: schema.company.id, name: schema.company.name })
      .from(schema.company)
      .all()
    const persons = db
      .select({
        id: schema.person.id,
        firstName: schema.person.first_name,
        lastName: schema.person.last_name
      })
      .from(schema.person)
      .all()
    const bands = db.select({ id: schema.band.id, name: schema.band.name }).from(schema.band).all()
    return { venues, bands, companies, persons }
  }

  /**
   * Writes the plan in one transaction: new records are created, existing
   * ones only get their empty fields filled, and links (venue → company,
   * contact persons, band members) are added where missing.
   */
  apply(plan: ImportPlan): ImportResult {
    return db.transaction((tx) => {
      const outcome = () => ({ created: 0, updated: 0 })
      const result: ImportResult = {
        venues: outcome(),
        bands: outcome(),
        companies: outcome(),
        persons: outcome()
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
              notes: notes || null,
              vat_number: draft.vatNumber,
              tax_number: draft.taxNumber,
              address_id: this.insertAddress(tx, draft.address),
              contact_id: this.insertContact(tx, draft.contact)
            })
            .returning({ id: schema.company.id })
            .get()
          companyIds.set(draft.key, created.id)
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
        companyIds.set(draft.key, row.id)
        const address = this.completeAddress(tx, row.address_id, draft.address)
        const contact = this.completeContact(tx, row.contact_id, draft.contact)
        const changes = emptyOnly(row, {
          notes,
          vat_number: draft.vatNumber,
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
        const membersAdded = this.addCompanyMembers(tx, row.id, draft.members, personIds)
        if (address.changed || contact.changed || hasValues(changes) || membersAdded > 0) {
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
              genre: draft.genre,
              founded: draft.founded || null,
              notes,
              company_id: draft.companyId,
              management_company_id: draft.managementCompanyId,
              responsible_person_id: responsibleId
            })
            .returning({ id: schema.band.id })
            .get()
          this.addBandMembers(tx, created.id, draft.members, personIds)
          result.bands.created++
          continue
        }
        const row = tx.select().from(schema.band).where(eq(schema.band.id, draft.existingId)).get()
        if (!row) throw new Error(`Band ${draft.existingId} nicht gefunden`)
        const changes = emptyOnly(row, {
          genre: draft.genre,
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
        const membersAdded = this.addBandMembers(tx, row.id, draft.members, personIds)
        if (hasValues(changes) || membersAdded > 0) result.bands.updated++
      }

      // ---- Venues ----
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
              notes,
              company_id: companyId,
              address_id: this.insertAddress(tx, draft.address),
              contact_id: this.insertContact(tx, draft.contact)
            })
            .returning({ id: schema.venue.id })
            .get()
          this.addVenueMembers(tx, created.id, draft.members, personIds)
          result.venues.created++
          continue
        }
        const row = tx
          .select()
          .from(schema.venue)
          .where(eq(schema.venue.id, draft.existingId))
          .get()
        if (!row) throw new Error(`Spielstätte ${draft.existingId} nicht gefunden`)
        const address = this.completeAddress(tx, row.address_id, draft.address)
        const contact = this.completeContact(tx, row.contact_id, draft.contact)
        const changes = emptyOnly(row, {
          notes,
          capacity: draft.capacity,
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
        const membersAdded = this.addVenueMembers(tx, row.id, draft.members, personIds)
        if (address.changed || contact.changed || hasValues(changes) || membersAdded > 0) {
          result.venues.updated++
        }
      }

      return result
    })
  }

  private insertAddress(tx: Tx, draft: AddressDraft): number | null {
    const values = addressValues(draft)
    if (!hasValues(values)) return null
    return tx.insert(schema.address).values(values).returning({ id: schema.address.id }).get().id
  }

  private insertContact(tx: Tx, draft: ContactDraft): number | null {
    const values = contactValues(draft)
    if (!hasValues(values)) return null
    return tx.insert(schema.contact).values(values).returning({ id: schema.contact.id }).get().id
  }

  /** Fills the empty fields of an existing address, or creates one */
  private completeAddress(
    tx: Tx,
    addressId: number | null,
    draft: AddressDraft
  ): { id: number | null; changed: boolean } {
    if (addressId === null) {
      const id = this.insertAddress(tx, draft)
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
      return { id, changed: id !== null }
    }
    const row = tx.select().from(schema.contact).where(eq(schema.contact.id, contactId)).get()
    if (!row) return { id: contactId, changed: false }
    const changes = emptyOnly(row, contactValues(draft))
    if (!hasValues(changes)) return { id: contactId, changed: false }
    tx.update(schema.contact).set(changes).where(eq(schema.contact.id, contactId)).run()
    return { id: contactId, changed: true }
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
