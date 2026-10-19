import { injectable } from 'tsyringe'
import { sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

@injectable()
export class SettingsRepository {
  /** All stored settings as key → JSON value */
  getAll(): Record<string, string> {
    const rows = db.select().from(schema.app_setting).all()
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }

  setMany(values: Record<string, string>): void {
    db.transaction((tx) => {
      for (const [key, value] of Object.entries(values)) {
        tx.insert(schema.app_setting)
          .values({ key, value })
          .onConflictDoUpdate({
            target: schema.app_setting.key,
            set: { value, updated_at: sql`datetime('now')` }
          })
          .run()
      }
    })
  }
}
