import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { UpsertItineraryInput } from '../api/schemas/itinerary.schema'

@injectable()
export class ItineraryRepository {
  async getByDealMemoId(dealMemoId: number) {
    const rows = await db
      .select()
      .from(schema.itinerary)
      .where(eq(schema.itinerary.deal_memo_id, dealMemoId))
      .limit(1)

    return rows[0] ?? null
  }

  /**
   * Create the itinerary if it does not exist, otherwise update it.
   * Returns the persisted record either way.
   */
  async upsert(input: UpsertItineraryInput) {
    const existing = await this.getByDealMemoId(input.dealMemoId)

    if (existing) {
      const result = await db
        .update(schema.itinerary)
        .set({
          notes: input.notes ?? existing.notes,
          get_in: input.getIn ?? existing.get_in,
          load_in: input.loadIn ?? existing.load_in,
          sound_check_main_act: input.soundCheckMainAct ?? existing.sound_check_main_act,
          sound_check_support: input.soundCheckSupport ?? existing.sound_check_support,
          dinner: input.dinner ?? existing.dinner,
          doors: input.doors ?? existing.doors,
          show_time_main_act: input.showTimeMainAct ?? existing.show_time_main_act,
          show_time_support: input.showTimeSupport ?? existing.show_time_support,
          curfew_stage: input.curfewStage ?? existing.curfew_stage,
          curfew_venue: input.curfewVenue ?? existing.curfew_venue,
          show_length: input.showLength ?? existing.show_length,
          updated_at: new Date().toISOString()
        })
        .where(eq(schema.itinerary.deal_memo_id, input.dealMemoId))
        .returning()
      return result[0]
    }

    const result = await db
      .insert(schema.itinerary)
      .values({
        deal_memo_id: input.dealMemoId,
        notes: input.notes ?? '',
        get_in: input.getIn ?? '',
        load_in: input.loadIn ?? '',
        sound_check_main_act: input.soundCheckMainAct ?? '',
        sound_check_support: input.soundCheckSupport ?? '',
        dinner: input.dinner ?? '',
        doors: input.doors ?? '',
        show_time_main_act: input.showTimeMainAct ?? '',
        show_time_support: input.showTimeSupport ?? '',
        curfew_stage: input.curfewStage ?? '',
        curfew_venue: input.curfewVenue ?? '',
        show_length: input.showLength ?? ''
      })
      .returning()

    return result[0]
  }

  async delete(dealMemoId: number) {
    await db.delete(schema.itinerary).where(eq(schema.itinerary.deal_memo_id, dealMemoId))
  }
}
