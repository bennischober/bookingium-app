import { eq, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import type {
  CreateBandMemberInput,
  UpdateBandMemberInput,
  CreateCompanyMemberInput,
  UpdateCompanyMemberInput,
  CreateVenueMemberInput,
  UpdateVenueMemberInput
} from '../api/schemas/relation.schema'
import type { PersonRelationsQueryResult } from '../api/mappers/relation.mapper'

@injectable()
export class RelationRepository {
  // ========================================
  // Person Relations Query
  // ========================================
  async getPersonRelations(personId: number): Promise<PersonRelationsQueryResult> {
    // The person is known here (queried by person_id); the name resolves from
    // the joined person row to satisfy the shared member query result shape.
    const personJoin = db
      .select({ firstName: schema.person.first_name, lastName: schema.person.last_name })
      .from(schema.person)
      .where(eq(schema.person.id, personId))
      .limit(1)
    const person = (await personJoin)[0]
    const personName = person ? `${person.firstName} ${person.lastName}` : ''

    // Get band memberships
    const bands = await db
      .select({
        id: schema.band_member.id,
        bandId: schema.band_member.band_id,
        bandName: schema.band.name,
        personId: schema.band_member.person_id,
        personName: sql<string>`${personName}`,
        role: schema.band_member.role,
        notes: schema.band_member.notes
      })
      .from(schema.band_member)
      .innerJoin(schema.band, eq(schema.band_member.band_id, schema.band.id))
      .where(eq(schema.band_member.person_id, personId))

    // Get company memberships
    const companies = await db
      .select({
        id: schema.company_member.id,
        companyId: schema.company_member.company_id,
        companyName: schema.company.name,
        personId: schema.company_member.person_id,
        personName: sql<string>`${personName}`,
        role: schema.company_member.role,
        notes: schema.company_member.notes
      })
      .from(schema.company_member)
      .innerJoin(schema.company, eq(schema.company_member.company_id, schema.company.id))
      .where(eq(schema.company_member.person_id, personId))

    // Get venue memberships
    const venues = await db
      .select({
        id: schema.venue_member.id,
        venueId: schema.venue_member.venue_id,
        venueName: schema.venue.name,
        personId: schema.venue_member.person_id,
        personName: sql<string>`${personName}`,
        role: schema.venue_member.role,
        notes: schema.venue_member.notes
      })
      .from(schema.venue_member)
      .innerJoin(schema.venue, eq(schema.venue_member.venue_id, schema.venue.id))
      .where(eq(schema.venue_member.person_id, personId))

    return { bands, companies, venues }
  }

  // ========================================
  // Band Member CRUD
  // ========================================
  async getBandMembers(bandId: number) {
    return await db
      .select({
        id: schema.band_member.id,
        bandId: schema.band_member.band_id,
        bandName: schema.band.name,
        personId: schema.band_member.person_id,
        personName: sql<string>`(${schema.person.first_name} || ' ' || ${schema.person.last_name})`,
        role: schema.band_member.role,
        notes: schema.band_member.notes
      })
      .from(schema.band_member)
      .innerJoin(schema.band, eq(schema.band_member.band_id, schema.band.id))
      .innerJoin(schema.person, eq(schema.band_member.person_id, schema.person.id))
      .where(eq(schema.band_member.band_id, bandId))
  }

  async addBandMember(input: CreateBandMemberInput) {
    const result = await db
      .insert(schema.band_member)
      .values({
        band_id: input.bandId,
        person_id: input.personId,
        role: input.role,
        notes: input.notes
      })
      .returning()

    return this.fetchBandMember(result[0].id)
  }

  async updateBandMember(input: UpdateBandMemberInput) {
    const updateData: Record<string, string> = {}
    if (input.role !== undefined) updateData.role = input.role
    if (input.notes !== undefined) updateData.notes = input.notes

    await db.update(schema.band_member).set(updateData).where(eq(schema.band_member.id, input.id))

    return this.fetchBandMember(input.id)
  }

  /** Re-selects a band member row with band name and person name resolved. */
  private async fetchBandMember(id: number) {
    const rows = await db
      .select({
        id: schema.band_member.id,
        bandId: schema.band_member.band_id,
        bandName: schema.band.name,
        personId: schema.band_member.person_id,
        personName: sql<string>`(${schema.person.first_name} || ' ' || ${schema.person.last_name})`,
        role: schema.band_member.role,
        notes: schema.band_member.notes
      })
      .from(schema.band_member)
      .innerJoin(schema.band, eq(schema.band_member.band_id, schema.band.id))
      .innerJoin(schema.person, eq(schema.band_member.person_id, schema.person.id))
      .where(eq(schema.band_member.id, id))

    return rows[0]
  }

  async removeBandMember(id: number) {
    await db.delete(schema.band_member).where(eq(schema.band_member.id, id))
  }

  // ========================================
  // Company Member CRUD
  // ========================================
  async getCompanyMembers(companyId: number) {
    return await db
      .select({
        id: schema.company_member.id,
        companyId: schema.company_member.company_id,
        companyName: schema.company.name,
        personId: schema.company_member.person_id,
        personName: sql<string>`(${schema.person.first_name} || ' ' || ${schema.person.last_name})`,
        role: schema.company_member.role,
        notes: schema.company_member.notes
      })
      .from(schema.company_member)
      .innerJoin(schema.company, eq(schema.company_member.company_id, schema.company.id))
      .innerJoin(schema.person, eq(schema.company_member.person_id, schema.person.id))
      .where(eq(schema.company_member.company_id, companyId))
  }

  async addCompanyMember(input: CreateCompanyMemberInput) {
    const result = await db
      .insert(schema.company_member)
      .values({
        company_id: input.companyId,
        person_id: input.personId,
        role: input.role,
        notes: input.notes
      })
      .returning()

    return this.fetchCompanyMember(result[0].id)
  }

  async updateCompanyMember(input: UpdateCompanyMemberInput) {
    const updateData: Record<string, string> = {}
    if (input.role !== undefined) updateData.role = input.role
    if (input.notes !== undefined) updateData.notes = input.notes

    await db
      .update(schema.company_member)
      .set(updateData)
      .where(eq(schema.company_member.id, input.id))

    return this.fetchCompanyMember(input.id)
  }

  /** Re-selects a company member row with company name and person name resolved. */
  private async fetchCompanyMember(id: number) {
    const rows = await db
      .select({
        id: schema.company_member.id,
        companyId: schema.company_member.company_id,
        companyName: schema.company.name,
        personId: schema.company_member.person_id,
        personName: sql<string>`(${schema.person.first_name} || ' ' || ${schema.person.last_name})`,
        role: schema.company_member.role,
        notes: schema.company_member.notes
      })
      .from(schema.company_member)
      .innerJoin(schema.company, eq(schema.company_member.company_id, schema.company.id))
      .innerJoin(schema.person, eq(schema.company_member.person_id, schema.person.id))
      .where(eq(schema.company_member.id, id))

    return rows[0]
  }

  async removeCompanyMember(id: number) {
    await db.delete(schema.company_member).where(eq(schema.company_member.id, id))
  }

  // ========================================
  // Venue Member CRUD
  // ========================================
  async getVenueMembers(venueId: number) {
    return await db
      .select({
        id: schema.venue_member.id,
        venueId: schema.venue_member.venue_id,
        venueName: schema.venue.name,
        personId: schema.venue_member.person_id,
        personName: sql<string>`(${schema.person.first_name} || ' ' || ${schema.person.last_name})`,
        role: schema.venue_member.role,
        notes: schema.venue_member.notes
      })
      .from(schema.venue_member)
      .innerJoin(schema.venue, eq(schema.venue_member.venue_id, schema.venue.id))
      .innerJoin(schema.person, eq(schema.venue_member.person_id, schema.person.id))
      .where(eq(schema.venue_member.venue_id, venueId))
  }

  async addVenueMember(input: CreateVenueMemberInput) {
    const result = await db
      .insert(schema.venue_member)
      .values({
        venue_id: input.venueId,
        person_id: input.personId,
        role: input.role,
        notes: input.notes
      })
      .returning()

    return this.fetchVenueMember(result[0].id)
  }

  async updateVenueMember(input: UpdateVenueMemberInput) {
    const updateData: Record<string, string> = {}
    if (input.role !== undefined) updateData.role = input.role
    if (input.notes !== undefined) updateData.notes = input.notes

    await db.update(schema.venue_member).set(updateData).where(eq(schema.venue_member.id, input.id))

    return this.fetchVenueMember(input.id)
  }

  /** Re-selects a venue member row with venue name and person name resolved. */
  private async fetchVenueMember(id: number) {
    const rows = await db
      .select({
        id: schema.venue_member.id,
        venueId: schema.venue_member.venue_id,
        venueName: schema.venue.name,
        personId: schema.venue_member.person_id,
        personName: sql<string>`(${schema.person.first_name} || ' ' || ${schema.person.last_name})`,
        role: schema.venue_member.role,
        notes: schema.venue_member.notes
      })
      .from(schema.venue_member)
      .innerJoin(schema.venue, eq(schema.venue_member.venue_id, schema.venue.id))
      .innerJoin(schema.person, eq(schema.venue_member.person_id, schema.person.id))
      .where(eq(schema.venue_member.id, id))

    return rows[0]
  }

  async removeVenueMember(id: number) {
    await db.delete(schema.venue_member).where(eq(schema.venue_member.id, id))
  }
}
