import { injectable } from 'tsyringe'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { sqlTimestamp } from '../db/timestamps'

const subscription = schema.calendar_subscription
const cache = schema.calendar_subscription_cache

/** A subscription with what this computer fetched of it */
export type CalendarSubscriptionRow = ReturnType<CalendarSubscriptionRepository['listAll']>[number]

// #53: the subscriptions are shared (synced), the cache stays on this computer
@injectable()
export class CalendarSubscriptionRepository {
  listAll() {
    return db
      .select({
        subscription,
        ics: cache.ics,
        fetched_at: cache.fetched_at,
        attempted_at: cache.attempted_at,
        error: cache.error
      })
      .from(subscription)
      .leftJoin(cache, eq(cache.subscription_id, subscription.id))
      .orderBy(asc(subscription.name), asc(subscription.id))
      .all()
  }

  findById(id: number) {
    return this.listAll().find((row) => row.subscription.id === id) ?? null
  }

  create(data: { name: string; url: string; color: string }) {
    return db.insert(subscription).values(data).returning().get()
  }

  update(id: number, data: { name?: string; color?: string; enabled?: boolean }) {
    return db
      .update(subscription)
      .set({ ...data, updated_at: sql`(datetime('now'))` })
      .where(eq(subscription.id, id))
      .returning()
      .get()
  }

  delete(id: number): boolean {
    return db.delete(subscription).where(eq(subscription.id, id)).run().changes > 0
  }

  /** A successful fetch: the feed replaces the cached one */
  saveFetched(id: number, ics: string, at = new Date()) {
    const now = sqlTimestamp(at)
    db.insert(cache)
      .values({ subscription_id: id, ics, fetched_at: now, attempted_at: now, error: '' })
      .onConflictDoUpdate({
        target: cache.subscription_id,
        set: { ics, fetched_at: now, attempted_at: now, error: '' }
      })
      .run()
  }

  /** A failed fetch: the last good feed stays */
  saveError(id: number, error: string, at = new Date()) {
    const now = sqlTimestamp(at)
    db.insert(cache)
      .values({ subscription_id: id, attempted_at: now, error })
      .onConflictDoUpdate({ target: cache.subscription_id, set: { attempted_at: now, error } })
      .run()
  }
}
