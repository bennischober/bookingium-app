import { injectable } from 'tsyringe'
import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from './archiveFilter'

export interface SourcePerson {
  firstName: string
  lastName: string
  role: string
  email: string
}

export interface SourceLoPro {
  // Company name, or the person's full name
  name: string
  firstName: string
  lastName: string
  // LoPro company of the event (for a person: the company they came with)
  company: string
  email: string
}

/**
 * Where Verteiler addresses come from: a venue or festival, or a media company
 * (company.kind 'media', #80). Media have no capacity, Veranstalter, LoPros or
 * bookings.
 */
export interface ListSource {
  // Venue id, or company id for media (kind tells which)
  id: number
  name: string
  // 'venue' | 'festival' | 'media'
  kind: string
  capacity: number | null
  genres: string
  city: string
  state: string
  zipCode: string
  country: string
  countryCode: string
  email: string
  // The venue's own company (Veranstalter)
  promoter: { name: string; email: string } | null
  // Ansprechpartner: venue members, or the media company's members
  members: SourcePerson[]
  // LoPro companies and persons of events at the venue (#51)
  lopros: SourceLoPro[]
  // Non-cancelled events at this venue
  bookings: { bandId: number; bandGenre: string }[]
}

/**
 * A record on a member list (#154): a person, a company or a club/festival,
 * reached through its primary address
 */
export interface ListMember {
  type: 'person' | 'company' | 'venue'
  id: number
  // Full name for a person
  name: string
  firstName: string
  lastName: string
  // A person's company (the first by name), a company's own name
  company: string
  email: string
  city: string
  country: string
  capacity: number | null
  // Clubs/festivals and media companies the record is or belongs to;
  // kind is venue.kind or 'media'
  sources: { id: number; kind: string; name: string; role: string }[]
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

@injectable()
export class ContactListRepository {
  /** Every venue, festival and media company with the addresses that can receive mail for it */
  loadSources(): ListSource[] {
    const venues = db
      .select()
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .orderBy(schema.venue.name)
      .all()

    const companyRows = db
      .select()
      .from(schema.company)
      .leftJoin(schema.address, eq(schema.company.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
      .orderBy(schema.company.name)
      .all()
    const companies = new Map(
      companyRows.map(({ company, contact }) => [
        company.id,
        { name: company.name, email: contact?.email ?? '' }
      ])
    )

    const venueMembers = new Map<number, SourcePerson[]>()
    for (const row of db
      .select({
        venueId: schema.venue_member.venue_id,
        role: schema.venue_member.role,
        firstName: schema.person.first_name,
        lastName: schema.person.last_name,
        email: schema.contact.email
      })
      .from(schema.venue_member)
      .innerJoin(schema.person, eq(schema.venue_member.person_id, schema.person.id))
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .orderBy(schema.person.last_name, schema.person.first_name)
      .all()) {
      pushTo(venueMembers, row.venueId, {
        firstName: row.firstName,
        lastName: row.lastName,
        role: row.role ?? '',
        email: row.email ?? ''
      })
    }

    const mediaMembers = new Map<number, SourcePerson[]>()
    for (const row of db
      .select({
        companyId: schema.company_member.company_id,
        role: schema.company_member.role,
        firstName: schema.person.first_name,
        lastName: schema.person.last_name,
        email: schema.contact.email
      })
      .from(schema.company_member)
      .innerJoin(schema.company, eq(schema.company_member.company_id, schema.company.id))
      .innerJoin(schema.person, eq(schema.company_member.person_id, schema.person.id))
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .where(eq(schema.company.kind, 'media'))
      .orderBy(schema.person.last_name, schema.person.first_name)
      .all()) {
      pushTo(mediaMembers, row.companyId, {
        firstName: row.firstName,
        lastName: row.lastName,
        role: row.role ?? '',
        email: row.email ?? ''
      })
    }

    const bookings = new Map<number, ListSource['bookings']>()
    const lopros = new Map<number, SourceLoPro[]>()
    for (const row of db
      .select({
        venueId: schema.deal_memo.venue_id,
        bandId: schema.deal_memo.band_id,
        bandGenre: schema.band.genre,
        status: schema.deal_memo.status,
        loProCompanyId: schema.deal_memo.lopro_company_id,
        loProPersonId: schema.deal_memo.lopro_person_id,
        loProFirstName: schema.person.first_name,
        loProLastName: schema.person.last_name,
        loProEmail: schema.contact.email
      })
      .from(schema.deal_memo)
      .innerJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.person, eq(schema.deal_memo.lopro_person_id, schema.person.id))
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      // D3: an archived gig is not a booking to reach out about
      .where(and(notArchived(), isNotNull(schema.deal_memo.venue_id)))
      .orderBy(desc(schema.deal_memo.date))
      .all()) {
      if (row.venueId === null) continue
      // A cancelled show is no booking, but its LoPro still works with the venue
      if (row.status !== 'cancelled') {
        pushTo(bookings, row.venueId, { bandId: row.bandId, bandGenre: row.bandGenre })
      }
      const loProCompany =
        row.loProCompanyId !== null ? (companies.get(row.loProCompanyId) ?? null) : null
      if (loProCompany) {
        pushTo(lopros, row.venueId, {
          name: loProCompany.name,
          firstName: '',
          lastName: '',
          company: loProCompany.name,
          email: loProCompany.email
        })
      }
      if (row.loProPersonId !== null && row.loProFirstName !== null) {
        const firstName = row.loProFirstName
        const lastName = row.loProLastName ?? ''
        pushTo(lopros, row.venueId, {
          name: `${firstName} ${lastName}`.trim(),
          firstName,
          lastName,
          company: loProCompany?.name ?? '',
          email: row.loProEmail ?? ''
        })
      }
    }

    const venueSources: ListSource[] = venues.map(({ venue, address, contact }) => ({
      id: venue.id,
      name: venue.name,
      kind: venue.kind,
      capacity: venue.capacity,
      genres: venue.genres,
      city: address?.city ?? '',
      state: address?.state ?? '',
      zipCode: address?.zip_code ?? '',
      country: address?.country ?? '',
      countryCode: address?.country_code ?? '',
      email: contact?.email ?? '',
      promoter: venue.company_id !== null ? (companies.get(venue.company_id) ?? null) : null,
      members: venueMembers.get(venue.id) ?? [],
      lopros: lopros.get(venue.id) ?? [],
      bookings: bookings.get(venue.id) ?? []
    }))

    const mediaSources: ListSource[] = companyRows
      .filter(({ company }) => company.kind === 'media')
      .map(({ company, address, contact }) => ({
        id: company.id,
        name: company.name,
        kind: 'media',
        capacity: null,
        genres: company.genres,
        city: address?.city ?? '',
        state: address?.state ?? '',
        zipCode: address?.zip_code ?? '',
        country: address?.country ?? '',
        countryCode: address?.country_code ?? '',
        email: contact?.email ?? '',
        promoter: null,
        members: mediaMembers.get(company.id) ?? [],
        lopros: [],
        bookings: []
      }))

    return [...venueSources, ...mediaSources]
  }

  /** Lower-case emails of every contact marked "Keine Werbung" */
  noAdvertisingEmails(): Set<string> {
    const rows = db
      .select({ email: schema.contact.email })
      .from(schema.contact)
      .where(eq(schema.contact.no_advertising, true))
      .all()
    return new Set(rows.map((row) => row.email.trim().toLowerCase()).filter(Boolean))
  }

  /** Sets the flag on every contact with this email (case-insensitive) */
  setNoAdvertising(email: string, noAdvertising: boolean): number {
    return db
      .update(schema.contact)
      .set({ no_advertising: noAdvertising })
      .where(sql`lower(trim(${schema.contact.email})) = ${email.trim().toLowerCase()}`)
      .run().changes
  }

  listBands(): { id: number; name: string; genre: string }[] {
    return db
      .select({ id: schema.band.id, name: schema.band.name, genre: schema.band.genre })
      .from(schema.band)
      .orderBy(schema.band.name)
      .all()
  }

  listSaved() {
    return db.select().from(schema.contact_list).orderBy(schema.contact_list.name).all()
  }

  getSaved(id: number) {
    return db.select().from(schema.contact_list).where(eq(schema.contact_list.id, id)).get()
  }

  /** The records of a member list (#154) with their current primary address */
  loadMembers(listId: number): ListMember[] {
    const onList = eq(schema.contact_list_member.contact_list_id, listId)
    const place = (address: { city: string; country: string; country_code: string } | null) => ({
      city: address?.city ?? '',
      country: address?.country || address?.country_code || ''
    })

    const listPersons = db
      .select({ id: schema.contact_list_member.person_id })
      .from(schema.contact_list_member)
      .where(and(onList, isNotNull(schema.contact_list_member.person_id)))
    const companiesOf = new Map<number, string[]>()
    const sourcesOf = new Map<number, ListMember['sources']>()
    for (const row of db
      .select({
        personId: schema.company_member.person_id,
        id: schema.company.id,
        name: schema.company.name,
        kind: schema.company.kind,
        role: schema.company_member.role
      })
      .from(schema.company_member)
      .innerJoin(schema.company, eq(schema.company_member.company_id, schema.company.id))
      .where(inArray(schema.company_member.person_id, listPersons))
      .orderBy(schema.company.name)
      .all()) {
      pushTo(companiesOf, row.personId, row.name)
      if (row.kind === 'media') {
        pushTo(sourcesOf, row.personId, {
          id: row.id,
          kind: 'media',
          name: row.name,
          role: row.role ?? ''
        })
      }
    }
    for (const row of db
      .select({
        personId: schema.venue_member.person_id,
        id: schema.venue.id,
        name: schema.venue.name,
        kind: schema.venue.kind,
        role: schema.venue_member.role
      })
      .from(schema.venue_member)
      .innerJoin(schema.venue, eq(schema.venue_member.venue_id, schema.venue.id))
      .where(inArray(schema.venue_member.person_id, listPersons))
      .orderBy(schema.venue.name)
      .all()) {
      pushTo(sourcesOf, row.personId, {
        id: row.id,
        kind: row.kind,
        name: row.name,
        role: row.role ?? ''
      })
    }

    const persons = db
      .select()
      .from(schema.contact_list_member)
      .innerJoin(schema.person, eq(schema.contact_list_member.person_id, schema.person.id))
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .leftJoin(schema.address, eq(schema.person.address_id, schema.address.id))
      .where(onList)
      .all()
      .map(
        ({ person, contact, address }): ListMember => ({
          type: 'person',
          id: person.id,
          name: `${person.first_name} ${person.last_name}`.trim(),
          firstName: person.first_name,
          lastName: person.last_name,
          company: companiesOf.get(person.id)?.[0] ?? '',
          email: contact?.email ?? '',
          ...place(address),
          capacity: null,
          sources: sourcesOf.get(person.id) ?? []
        })
      )

    const companies = db
      .select()
      .from(schema.contact_list_member)
      .innerJoin(schema.company, eq(schema.contact_list_member.company_id, schema.company.id))
      .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
      .leftJoin(schema.address, eq(schema.company.address_id, schema.address.id))
      .where(onList)
      .all()
      .map(
        ({ company, contact, address }): ListMember => ({
          type: 'company',
          id: company.id,
          name: company.name,
          firstName: '',
          lastName: '',
          company: company.name,
          email: contact?.email ?? '',
          ...place(address),
          capacity: null,
          sources:
            company.kind === 'media'
              ? [{ id: company.id, kind: 'media', name: company.name, role: '' }]
              : []
        })
      )

    const venues = db
      .select()
      .from(schema.contact_list_member)
      .innerJoin(schema.venue, eq(schema.contact_list_member.venue_id, schema.venue.id))
      .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .where(onList)
      .all()
      .map(
        ({ venue, contact, address }): ListMember => ({
          type: 'venue',
          id: venue.id,
          name: venue.name,
          firstName: '',
          lastName: '',
          company: '',
          email: contact?.email ?? '',
          ...place(address),
          capacity: venue.capacity,
          sources: [{ id: venue.id, kind: venue.kind, name: venue.name, role: '' }]
        })
      )

    return [...persons, ...companies, ...venues]
  }

  /** Takes every record whose primary address is this one off the member list */
  removeMembersByEmail(listId: number, email: string): number {
    const matches = sql`lower(trim(${schema.contact.email})) = ${email.trim().toLowerCase()}`
    const personIds = db
      .select({ id: schema.person.id })
      .from(schema.person)
      .innerJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .where(matches)
    const companyIds = db
      .select({ id: schema.company.id })
      .from(schema.company)
      .innerJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
      .where(matches)
    const venueIds = db
      .select({ id: schema.venue.id })
      .from(schema.venue)
      .innerJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .where(matches)
    return db
      .delete(schema.contact_list_member)
      .where(
        and(
          eq(schema.contact_list_member.contact_list_id, listId),
          or(
            inArray(schema.contact_list_member.person_id, personIds),
            inArray(schema.contact_list_member.company_id, companyIds),
            inArray(schema.contact_list_member.venue_id, venueIds)
          )
        )
      )
      .run().changes
  }

  insertSaved(name: string, filters: string) {
    return db.insert(schema.contact_list).values({ name, filters }).returning().get()
  }

  /** filters null: only the name changes (member lists) */
  updateSaved(id: number, name: string, filters: string | null) {
    return db
      .update(schema.contact_list)
      .set({ name, ...(filters !== null && { filters }), updated_at: sql`datetime('now')` })
      .where(eq(schema.contact_list.id, id))
      .returning()
      .get()
  }

  deleteSaved(id: number): void {
    db.delete(schema.contact_list).where(eq(schema.contact_list.id, id)).run()
  }
}
