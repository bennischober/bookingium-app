import { injectable } from 'tsyringe'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

const own = isNull(schema.mail_template.kind)

// #123: the user's own mail templates, and what their placeholders need from an event.
// #136: also the edited fixed texts (rows with kind and lang), which the own-template
// methods never return or change.
@injectable()
export class MailTemplateRepository {
  list() {
    return db
      .select()
      .from(schema.mail_template)
      .where(own)
      .orderBy(sql`${schema.mail_template.name} COLLATE NOCASE`)
      .all()
  }

  /** The edited fixed texts */
  documents() {
    return db.select().from(schema.mail_template).where(isNotNull(schema.mail_template.kind)).all()
  }

  document(kind: string, lang: string) {
    return db
      .select()
      .from(schema.mail_template)
      .where(and(eq(schema.mail_template.kind, kind), eq(schema.mail_template.lang, lang)))
      .get()
  }

  saveDocument(kind: string, lang: string, subject: string, body: string) {
    return db
      .insert(schema.mail_template)
      .values({ name: '', subject, body, kind, lang })
      .onConflictDoUpdate({
        target: [schema.mail_template.kind, schema.mail_template.lang],
        set: { subject, body, updated_at: sql`datetime('now')` }
      })
      .returning()
      .get()
  }

  resetDocument(kind: string, lang: string): void {
    db.delete(schema.mail_template)
      .where(and(eq(schema.mail_template.kind, kind), eq(schema.mail_template.lang, lang)))
      .run()
  }

  insert(name: string, subject: string, body: string) {
    return db.insert(schema.mail_template).values({ name, subject, body }).returning().get()
  }

  update(id: number, name: string, subject: string, body: string) {
    return db
      .update(schema.mail_template)
      .set({ name, subject, body, updated_at: sql`datetime('now')` })
      .where(and(eq(schema.mail_template.id, id), own))
      .returning()
      .get()
  }

  delete(id: number): void {
    db.delete(schema.mail_template)
      .where(and(eq(schema.mail_template.id, id), own))
      .run()
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
