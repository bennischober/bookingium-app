import { injectable } from 'tsyringe'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

export type MailRuleRow = typeof schema.mail_rule.$inferSelect
export type MailRuleValues = Omit<
  typeof schema.mail_rule.$inferInsert,
  'id' | 'position' | 'hit_count' | 'last_applied_at' | 'last_error' | 'created_at' | 'updated_at'
>

// #124: rules for incoming mail and the mails they have handled
@injectable()
export class MailRuleRepository {
  list() {
    return db
      .select()
      .from(schema.mail_rule)
      .orderBy(
        asc(schema.mail_rule.mail_account_id),
        asc(schema.mail_rule.position),
        asc(schema.mail_rule.id)
      )
      .all()
  }

  get(id: number) {
    return db.select().from(schema.mail_rule).where(eq(schema.mail_rule.id, id)).get()
  }

  /** One account's switched-on rules, in their order */
  enabledFor(accountId: string) {
    return db
      .select()
      .from(schema.mail_rule)
      .where(
        and(eq(schema.mail_rule.mail_account_id, accountId), eq(schema.mail_rule.enabled, true))
      )
      .orderBy(asc(schema.mail_rule.position), asc(schema.mail_rule.id))
      .all()
  }

  /** A new rule goes last in its account's order */
  insert(values: MailRuleValues) {
    const last = db
      .select({ max: sql<number | null>`max(${schema.mail_rule.position})` })
      .from(schema.mail_rule)
      .where(eq(schema.mail_rule.mail_account_id, values.mail_account_id))
      .get()
    return db
      .insert(schema.mail_rule)
      .values({ ...values, position: (last?.max ?? -1) + 1 })
      .returning()
      .get()
  }

  update(id: number, values: Partial<MailRuleValues> & { last_error?: string | null }) {
    return db
      .update(schema.mail_rule)
      .set({ ...values, updated_at: sql`datetime('now')` })
      .where(eq(schema.mail_rule.id, id))
      .returning()
      .get()
  }

  delete(id: number): void {
    db.delete(schema.mail_rule).where(eq(schema.mail_rule.id, id)).run()
  }

  /** Swaps the positions of two rules of one account */
  swapPositions(a: MailRuleRow, b: MailRuleRow): void {
    db.transaction((tx) => {
      tx.update(schema.mail_rule)
        .set({ position: b.position })
        .where(eq(schema.mail_rule.id, a.id))
        .run()
      tx.update(schema.mail_rule)
        .set({ position: a.position })
        .where(eq(schema.mail_rule.id, b.id))
        .run()
    })
  }

  /** Gives one account's rules the positions 0..n-1 in their current order */
  renumber(accountId: string): MailRuleRow[] {
    return db.transaction((tx) => {
      const rows = tx
        .select()
        .from(schema.mail_rule)
        .where(eq(schema.mail_rule.mail_account_id, accountId))
        .orderBy(asc(schema.mail_rule.position), asc(schema.mail_rule.id))
        .all()
      rows.forEach((row, index) => {
        if (row.position === index) return
        tx.update(schema.mail_rule)
          .set({ position: index })
          .where(eq(schema.mail_rule.id, row.id))
          .run()
        row.position = index
      })
      return rows
    })
  }

  /** The mail keys among `keys` that these rules have already handled, as `ruleId:key` */
  hitsAmong(ruleIds: number[], keys: string[]): Set<string> {
    const out = new Set<string>()
    if (ruleIds.length === 0 || keys.length === 0) return out
    for (let i = 0; i < keys.length; i += 400) {
      const rows = db
        .select({ rule_id: schema.mail_rule_hit.rule_id, mail_key: schema.mail_rule_hit.mail_key })
        .from(schema.mail_rule_hit)
        .where(
          and(
            inArray(schema.mail_rule_hit.rule_id, ruleIds),
            inArray(schema.mail_rule_hit.mail_key, keys.slice(i, i + 400))
          )
        )
        .all()
      for (const row of rows) out.add(`${row.rule_id}:${row.mail_key}`)
    }
    return out
  }

  /** A rule that matched but could do nothing says why, without counting a hit */
  noteError(ruleId: number, error: string): void {
    db.update(schema.mail_rule)
      .set({ last_error: error })
      .where(eq(schema.mail_rule.id, ruleId))
      .run()
  }

  /**
   * Records what one run did with a rule: the mails it handled, the hit count, when it was last
   * applied and the error of this run (null clears an earlier one).
   */
  recordRun(ruleId: number, keys: string[], appliedAt: string, error: string | null): void {
    db.transaction((tx) => {
      for (const key of keys) {
        tx.insert(schema.mail_rule_hit)
          .values({ rule_id: ruleId, mail_key: key, applied_at: appliedAt })
          .onConflictDoNothing()
          .run()
      }
      tx.update(schema.mail_rule)
        .set({
          hit_count: sql`${schema.mail_rule.hit_count} + ${keys.length}`,
          last_applied_at: appliedAt,
          last_error: error
        })
        .where(eq(schema.mail_rule.id, ruleId))
        .run()
    })
  }
}
