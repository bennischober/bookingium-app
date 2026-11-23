import { and, eq, inArray, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import { sqlTimestamp } from '../db/timestamps'
import { keyOf, type PlaceKind } from '../showfolder/extract'
import type { ShowFolderCurrent } from '../showfolder/plan'

const now = sql`(datetime('now'))`

/** venue.kind as stored ('venue' | 'festival', CHECK) */
const placeKind = (kind: string): PlaceKind => (kind === 'festival' ? 'festival' : 'venue')

/**
 * "Show-Ordner einlesen": what is stored for an event, its club and hotel, and the single-column
 * writes the ticked suggestions make. Every write sets one thing only, so nothing else of a
 * record is touched (no full-form update that could wipe a field).
 */
@injectable()
export class ShowFolderRepository {
  event(eventId: number) {
    return db
      .select({
        id: schema.deal_memo.id,
        bandId: schema.deal_memo.band_id,
        bandName: schema.band.name,
        venueId: schema.deal_memo.venue_id,
        hotelId: schema.deal_memo.hotel_id,
        presaleCents: schema.deal_memo.ticket_price_vvk_cents,
        guaranteeCents: schema.deal_memo.guarantee_cents,
        deal: schema.deal_memo.deal,
        loproPersonId: schema.deal_memo.lopro_person_id,
        loproCompanyId: schema.deal_memo.lopro_company_id,
        invoiceCompanyId: schema.deal_memo.invoice_company_id,
        bandCompanyId: schema.band.company_id
      })
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.band.id, schema.deal_memo.band_id))
      .where(eq(schema.deal_memo.id, eventId))
      .get()
  }

  venue(venueId: number) {
    return db
      .select({
        id: schema.venue.id,
        name: schema.venue.name,
        kind: schema.venue.kind,
        capacity: schema.venue.capacity,
        notes: schema.venue.notes,
        addressId: schema.venue.address_id,
        street: schema.address.street,
        streetNumber: schema.address.street_number,
        zipCode: schema.address.zip_code,
        city: schema.address.city
      })
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.address.id, schema.venue.address_id))
      .where(eq(schema.venue.id, venueId))
      .get()
  }

  /** What the plan compares against; null when the event does not exist */
  current(
    eventId: number,
    hotelName: string,
    emails: string[],
    venueName = '',
    promoterName = '',
    invoiceRecipientName = ''
  ): ShowFolderCurrent | null {
    const event = this.event(eventId)
    if (!event) return null
    const venue = event.venueId !== null ? this.venue(event.venueId) : undefined
    const venueKey = keyOf(venueName)
    const venueByName =
      !venue && venueKey
        ? db
            .select({ id: schema.venue.id, name: schema.venue.name, kind: schema.venue.kind })
            .from(schema.venue)
            .all()
            .find((row) => keyOf(row.name) === venueKey)
        : undefined
    const itinerary = db
      .select()
      .from(schema.itinerary)
      .where(eq(schema.itinerary.deal_memo_id, eventId))
      .get()
    const hotel =
      event.hotelId !== null
        ? db
            .select({ id: schema.hotel.id, name: schema.hotel.name })
            .from(schema.hotel)
            .where(eq(schema.hotel.id, event.hotelId))
            .get()
        : undefined
    const hotelKey = keyOf(hotelName)
    const hotelByName = hotelKey
      ? db
          .select({ id: schema.hotel.id, name: schema.hotel.name })
          .from(schema.hotel)
          .all()
          .find((row) => keyOf(row.name) === hotelKey)
      : undefined
    const advancing = db
      .select({ localContactId: schema.event_advancing.local_contact_id })
      .from(schema.event_advancing)
      .where(eq(schema.event_advancing.deal_memo_id, eventId))
      .get()
    const documents = (ownerType: 'event' | 'venue', ownerId: number | null | undefined) =>
      new Set(
        ownerId == null
          ? []
          : db
              .select({ name: schema.document.file_name })
              .from(schema.document)
              .where(
                and(
                  eq(schema.document.owner_type, ownerType),
                  eq(schema.document.owner_id, ownerId)
                )
              )
              .all()
              .map((row) => row.name)
      )
    const members = venue
      ? db
          .select({ personId: schema.venue_member.person_id })
          .from(schema.venue_member)
          .where(eq(schema.venue_member.venue_id, venue.id))
          .all()
          .map((row) => row.personId)
      : []
    const settlement = db
      .select({ id: schema.event_settlement.id })
      .from(schema.event_settlement)
      .where(eq(schema.event_settlement.deal_memo_id, eventId))
      .get()

    return {
      itinerary: itinerary
        ? {
            getIn: itinerary.get_in,
            loadIn: itinerary.load_in,
            soundCheckMainAct: itinerary.sound_check_main_act,
            soundCheckSupport: itinerary.sound_check_support,
            dinner: itinerary.dinner,
            doors: itinerary.doors,
            showTimeSupport: itinerary.show_time_support,
            showTimeMainAct: itinerary.show_time_main_act,
            showLength: itinerary.show_length,
            curfewStage: itinerary.curfew_stage,
            curfewVenue: itinerary.curfew_venue
          }
        : {},
      presaleCents: event.presaleCents ?? null,
      guaranteeCents: event.guaranteeCents ?? null,
      deal: event.deal ?? '',
      venue: venue
        ? {
            name: venue.name,
            kind: placeKind(venue.kind),
            capacity: venue.capacity,
            street: venue.street ?? '',
            streetNumber: venue.streetNumber ?? '',
            zipCode: venue.zipCode ?? '',
            city: venue.city ?? '',
            notes: venue.notes
          }
        : null,
      venueByName: venueByName ? { ...venueByName, kind: placeKind(venueByName.kind) } : null,
      hotel: hotel ?? null,
      hotelByName: hotelByName ?? null,
      loproPersonId: event.loproPersonId,
      ...this.promoterOf(event.loproCompanyId, promoterName),
      ...this.invoiceCompanyOf(event.invoiceCompanyId, invoiceRecipientName),
      localContactId: advancing?.localContactId ?? null,
      personsByEmail: this.personsByEmail(emails),
      venueMemberIds: new Set(members),
      eventDocuments: documents('event', eventId),
      venueDocuments: documents('venue', venue?.id),
      hasSettlement: settlement !== undefined
    }
  }

  /** A company by its name as keyOf compares it, null when none */
  companyByName(name: string): { id: number; name: string } | null {
    const key = keyOf(name)
    if (!key) return null
    return (
      db
        .select({ id: schema.company.id, name: schema.company.name })
        .from(schema.company)
        .all()
        .find((row) => keyOf(row.name) === key) ?? null
    )
  }

  /** #262 archive import: the event's billing company, and a stored one of the invoice's name */
  private invoiceCompanyOf(
    invoiceCompanyId: number | null,
    recipientName: string
  ): Pick<ShowFolderCurrent, 'invoiceCompany' | 'invoiceCompanyByName'> {
    const invoiceCompany =
      invoiceCompanyId !== null
        ? db
            .select({ id: schema.company.id, name: schema.company.name })
            .from(schema.company)
            .where(eq(schema.company.id, invoiceCompanyId))
            .get()
        : undefined
    return {
      invoiceCompany: invoiceCompany ?? null,
      invoiceCompanyByName: this.companyByName(recipientName)
    }
  }

  /**
   * The names an invoice of ours carries as its sender: the event's band, the band's company and
   * the default own company
   */
  ownNames(eventId: number): string[] {
    const event = this.event(eventId)
    return event ? this.ownNamesOfBand(event.bandId) : []
  }

  /** The same for a band, before its event exists (archive import) */
  ownNamesOfBand(bandId: number): string[] {
    const band = db
      .select({ name: schema.band.name, companyId: schema.band.company_id })
      .from(schema.band)
      .where(eq(schema.band.id, bandId))
      .get()
    if (!band) return []
    const names = [band.name]
    const companies = db
      .select({
        id: schema.company.id,
        name: schema.company.name,
        own: schema.company.is_default_for_invoicing
      })
      .from(schema.company)
      .all()
    for (const company of companies)
      if (company.own || company.id === band.companyId) names.push(company.name)
    return names.filter(Boolean)
  }

  /** A club or festival by its name as keyOf compares it */
  venueByName(name: string): { id: number; name: string; kind: PlaceKind } | null {
    const key = keyOf(name)
    if (!key) return null
    const row = db
      .select({ id: schema.venue.id, name: schema.venue.name, kind: schema.venue.kind })
      .from(schema.venue)
      .all()
      .find((venue) => keyOf(venue.name) === key)
    return row ? { ...row, kind: placeKind(row.kind) } : null
  }

  /** The band's event on a day (the first, when there are two) */
  eventOn(bandId: number, date: string): { id: number; name: string } | null {
    return (
      db
        .select({ id: schema.deal_memo.id, name: schema.deal_memo.name })
        .from(schema.deal_memo)
        .where(and(eq(schema.deal_memo.band_id, bandId), eq(schema.deal_memo.date, date)))
        .orderBy(schema.deal_memo.id)
        .get() ?? null
    )
  }

  /** A new event from the archive: confirmed, archived when it lies in the past */
  createArchivedEvent(input: {
    bandId: number
    name: string
    date: string
    notes: string
    archived: boolean
  }): number {
    return db
      .insert(schema.deal_memo)
      .values({
        name: input.name,
        date: input.date,
        band_id: input.bandId,
        status: 'confirmed',
        notes: input.notes,
        archived_at: input.archived ? sqlTimestamp() : null
      })
      .returning({ id: schema.deal_memo.id })
      .get().id
  }

  setInvoiceCompany(eventId: number, companyId: number): void {
    db.update(schema.deal_memo)
      .set({ invoice_company_id: companyId, updated_at: now })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
  }

  /**
   * Fills the empty fields of a company (address, contact, VAT id, tax and KSK number) and never
   * changes one that holds something
   */
  fillCompanyGaps(
    companyId: number,
    fields: {
      street: string
      streetNumber: string
      zipCode: string
      city: string
      countryCode: string
      email: string
      phone: string
      website?: string
      vatId: string
      taxNumber: string
      kskNumber: string
    }
  ): number {
    const company = db.select().from(schema.company).where(eq(schema.company.id, companyId)).get()
    if (!company) return 0
    let filled = 0
    db.transaction((tx) => {
      const own: Partial<typeof schema.company.$inferInsert> = {}
      if (!company.vat_id && fields.vatId) own.vat_id = fields.vatId
      if (!company.tax_number && fields.taxNumber) own.tax_number = fields.taxNumber
      if (!company.ksk_number && fields.kskNumber) own.ksk_number = fields.kskNumber
      const address = company.address_id
        ? tx.select().from(schema.address).where(eq(schema.address.id, company.address_id)).get()
        : undefined
      const addressEmpty = !address || (!address.street && !address.zip_code && !address.city)
      if (addressEmpty && (fields.street || fields.zipCode || fields.city)) {
        const values = {
          street: fields.street,
          street_number: fields.streetNumber,
          zip_code: fields.zipCode,
          city: fields.city,
          country_code: fields.countryCode
        }
        if (address)
          tx.update(schema.address).set(values).where(eq(schema.address.id, address.id)).run()
        else
          own.address_id = tx
            .insert(schema.address)
            .values(values)
            .returning({ id: schema.address.id })
            .get().id
        filled++
      }
      const contact = company.contact_id
        ? tx.select().from(schema.contact).where(eq(schema.contact.id, company.contact_id)).get()
        : undefined
      const contactValues: Partial<typeof schema.contact.$inferInsert> = {}
      if (!contact?.email && fields.email) contactValues.email = fields.email
      if (!contact?.phone && fields.phone) contactValues.phone = fields.phone
      if (!contact?.homepage && fields.website) contactValues.homepage = fields.website
      if (Object.keys(contactValues).length > 0) {
        if (contact)
          tx.update(schema.contact)
            .set(contactValues)
            .where(eq(schema.contact.id, contact.id))
            .run()
        else
          own.contact_id = tx
            .insert(schema.contact)
            .values(contactValues)
            .returning({ id: schema.contact.id })
            .get().id
        filled++
      }
      filled += [own.vat_id, own.tax_number, own.ksk_number].filter(Boolean).length
      if (Object.keys(own).length > 0)
        tx.update(schema.company)
          .set({ ...own, updated_at: now })
          .where(eq(schema.company.id, companyId))
          .run()
    })
    return filled
  }

  /** Persons by their primary or further e-mail, lower-cased */
  personsByEmail(emails: string[]): Map<string, { id: number; name: string }> {
    const wanted = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
    const found = new Map<string, { id: number; name: string }>()
    if (wanted.length === 0) return found
    const primary = db
      .select({
        id: schema.person.id,
        first: schema.person.first_name,
        last: schema.person.last_name,
        email: schema.contact.email
      })
      .from(schema.person)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.person.contact_id))
      .where(inArray(sql`lower(${schema.contact.email})`, wanted))
      .all()
    const further = db
      .select({
        id: schema.person.id,
        first: schema.person.first_name,
        last: schema.person.last_name,
        email: schema.contact_email.email
      })
      .from(schema.contact_email)
      .innerJoin(schema.person, eq(schema.person.contact_id, schema.contact_email.contact_id))
      .where(inArray(schema.contact_email.email, wanted))
      .all()
    for (const row of [...primary, ...further]) {
      const email = row.email.toLowerCase()
      if (!found.has(email))
        found.set(email, { id: row.id, name: `${row.first} ${row.last}`.trim() })
    }
    return found
  }

  setPresale(eventId: number, cents: number): void {
    db.update(schema.deal_memo)
      .set({ ticket_price_vvk_cents: cents, updated_at: now })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
  }

  setGuarantee(eventId: number, cents: number): void {
    db.update(schema.deal_memo)
      .set({ guarantee_cents: cents, updated_at: now })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
  }

  setDeal(eventId: number, text: string): void {
    db.update(schema.deal_memo)
      .set({ deal: text, updated_at: now })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
  }

  /** The event's LoPro company, a company of the contract's promoter name, their members */
  private promoterOf(
    loproCompanyId: number | null,
    promoterName: string
  ): Pick<ShowFolderCurrent, 'loproCompany' | 'companyByName' | 'companyMemberIds'> {
    const loproCompany =
      loproCompanyId !== null
        ? db
            .select({ id: schema.company.id, name: schema.company.name })
            .from(schema.company)
            .where(eq(schema.company.id, loproCompanyId))
            .get()
        : undefined
    const key = keyOf(promoterName)
    const companyByName = key
      ? db
          .select({ id: schema.company.id, name: schema.company.name })
          .from(schema.company)
          .all()
          .find((row) => keyOf(row.name) === key)
      : undefined
    const companyIds = [loproCompany?.id, companyByName?.id].filter(
      (id): id is number => id !== undefined
    )
    const members =
      companyIds.length === 0
        ? []
        : db
            .select({ personId: schema.company_member.person_id })
            .from(schema.company_member)
            .where(inArray(schema.company_member.company_id, companyIds))
            .all()
            .map((row) => row.personId)
    return {
      loproCompany: loproCompany ?? null,
      companyByName: companyByName ?? null,
      companyMemberIds: new Set(members)
    }
  }

  /** The event's promoter company (LoPro) */
  setLoproCompany(eventId: number, companyId: number): void {
    db.update(schema.deal_memo)
      .set({ lopro_company_id: companyId, updated_at: now })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
  }

  addCompanyMember(companyId: number, personId: number, role: string): void {
    const exists = db
      .select({ id: schema.company_member.id })
      .from(schema.company_member)
      .where(
        and(
          eq(schema.company_member.company_id, companyId),
          eq(schema.company_member.person_id, personId)
        )
      )
      .get()
    if (!exists)
      db.insert(schema.company_member)
        .values({ company_id: companyId, person_id: personId, role: role || null })
        .run()
  }

  /** The event's club or festival */
  setVenue(eventId: number, venueId: number): void {
    db.update(schema.deal_memo)
      .set({ venue_id: venueId, updated_at: now })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
  }

  /** Club or festival */
  setVenueKind(venueId: number, kind: 'venue' | 'festival'): void {
    db.update(schema.venue).set({ kind, updated_at: now }).where(eq(schema.venue.id, venueId)).run()
  }

  setHotel(eventId: number, hotelId: number): void {
    db.update(schema.deal_memo)
      .set({ hotel_id: hotelId, updated_at: now })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
  }

  setLopro(eventId: number, personId: number): void {
    db.update(schema.deal_memo)
      .set({ lopro_person_id: personId, updated_at: now })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
  }

  setVenueCapacity(venueId: number, capacity: number): void {
    db.update(schema.venue)
      .set({ capacity, capacity_min: null, updated_at: now })
      .where(eq(schema.venue.id, venueId))
      .run()
  }

  /** Appends lines to the club's notes, under the name of the file they come from */
  appendVenueNotes(venueId: number, heading: string, lines: string[]): void {
    const venue = this.venue(venueId)
    if (!venue) return
    const block = [heading, ...lines.map((line) => `- ${line}`)].join('\n')
    const notes = venue.notes.trim() ? `${venue.notes.trimEnd()}\n\n${block}` : block
    db.update(schema.venue)
      .set({ notes, updated_at: now })
      .where(eq(schema.venue.id, venueId))
      .run()
  }

  /** The club's address: its own row is updated, a club without one gets a new row */
  setVenueAddress(
    venueId: number,
    address: { street: string; streetNumber: string; zipCode: string; city: string }
  ): void {
    const venue = this.venue(venueId)
    if (!venue) return
    db.transaction((tx) => {
      if (venue.addressId !== null) {
        tx.update(schema.address)
          .set({
            street: address.street,
            street_number: address.streetNumber,
            zip_code: address.zipCode,
            city: address.city
          })
          .where(eq(schema.address.id, venue.addressId))
          .run()
      } else {
        const row = tx
          .insert(schema.address)
          .values({
            street: address.street,
            street_number: address.streetNumber,
            zip_code: address.zipCode,
            city: address.city
          })
          .returning({ id: schema.address.id })
          .get()
        tx.update(schema.venue)
          .set({ address_id: row.id })
          .where(eq(schema.venue.id, venueId))
          .run()
      }
      tx.update(schema.venue).set({ updated_at: now }).where(eq(schema.venue.id, venueId)).run()
    })
  }

  addVenueMember(venueId: number, personId: number, role: string): void {
    db.insert(schema.venue_member)
      .values({ venue_id: venueId, person_id: personId, role: role || null })
      .onConflictDoNothing()
      .run()
  }

  /** Kontakt vor Ort; the advancing row keeps its status and notes */
  setLocalContact(eventId: number, personId: number): void {
    db.insert(schema.event_advancing)
      .values({ deal_memo_id: eventId, local_contact_id: personId })
      .onConflictDoUpdate({
        target: schema.event_advancing.deal_memo_id,
        set: { local_contact_id: personId, updated_at: now }
      })
      .run()
  }
}
