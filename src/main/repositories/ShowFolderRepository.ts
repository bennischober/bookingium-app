import { and, eq, inArray, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import { keyOf } from '../showfolder/extract'
import type { ShowFolderCurrent } from '../showfolder/plan'

const now = sql`(datetime('now'))`

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
        loproPersonId: schema.deal_memo.lopro_person_id
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
  current(eventId: number, hotelName: string, emails: string[]): ShowFolderCurrent | null {
    const event = this.event(eventId)
    if (!event) return null
    const venue = event.venueId !== null ? this.venue(event.venueId) : undefined
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
            capacity: venue.capacity,
            street: venue.street ?? '',
            streetNumber: venue.streetNumber ?? '',
            zipCode: venue.zipCode ?? '',
            city: venue.city ?? '',
            notes: venue.notes
          }
        : null,
      hotel: hotel ?? null,
      hotelByName: hotelByName ?? null,
      loproPersonId: event.loproPersonId,
      localContactId: advancing?.localContactId ?? null,
      personsByEmail: this.personsByEmail(emails),
      venueMemberIds: new Set(members),
      eventDocuments: documents('event', eventId),
      venueDocuments: documents('venue', venue?.id),
      hasSettlement: settlement !== undefined
    }
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
