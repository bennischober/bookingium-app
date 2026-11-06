import { injectable } from 'tsyringe'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

// #123: the user's own mail templates, and what their placeholders need from an event
@injectable()
export class MailTemplateRepository {
  list() {
    return db
      .select()
      .from(schema.mail_template)
      .orderBy(sql`${schema.mail_template.name} COLLATE NOCASE`)
      .all()
  }

  insert(name: string, subject: string, body: string) {
    return db.insert(schema.mail_template).values({ name, subject, body }).returning().get()
  }

  update(id: number, name: string, subject: string, body: string) {
    return db
      .update(schema.mail_template)
      .set({ name, subject, body, updated_at: sql`datetime('now')` })
      .where(eq(schema.mail_template.id, id))
      .returning()
      .get()
  }

  delete(id: number): void {
    db.delete(schema.mail_template).where(eq(schema.mail_template.id, id)).run()
  }

  /** The event with its band, venue (and the venue's city) and LoPro; undefined if gone */
  event(id: number) {
    return db
      .select({
        name: schema.deal_memo.name,
        date: schema.deal_memo.date,
        performanceTime: schema.deal_memo.performance_time,
        band: schema.band.name,
        venue: schema.venue.name,
        city: schema.address.city,
        loproFirstName: schema.person.first_name,
        loproLastName: schema.person.last_name,
        loproCompany: schema.company.name
      })
      .from(schema.deal_memo)
      .innerJoin(schema.band, eq(schema.band.id, schema.deal_memo.band_id))
      .leftJoin(schema.venue, eq(schema.venue.id, schema.deal_memo.venue_id))
      .leftJoin(schema.address, eq(schema.address.id, schema.venue.address_id))
      .leftJoin(schema.person, eq(schema.person.id, schema.deal_memo.lopro_person_id))
      .leftJoin(schema.company, eq(schema.company.id, schema.deal_memo.lopro_company_id))
      .where(eq(schema.deal_memo.id, id))
      .get()
  }
}
