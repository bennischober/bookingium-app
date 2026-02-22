import { itinerary } from '../../db/schema'
import type { ItineraryDto } from '../schemas/itinerary.schema'

type ItineraryEntity = typeof itinerary.$inferSelect

export class ItineraryMapper {
  static toDto(entity: ItineraryEntity): ItineraryDto {
    return {
      id: entity.id,
      dealMemoId: entity.deal_memo_id,
      notes: entity.notes,
      getIn: entity.get_in,
      loadIn: entity.load_in,
      soundCheckMainAct: entity.sound_check_main_act,
      soundCheckSupport: entity.sound_check_support,
      dinner: entity.dinner,
      doors: entity.doors,
      showTimeMainAct: entity.show_time_main_act,
      showTimeSupport: entity.show_time_support,
      curfewStage: entity.curfew_stage,
      curfewVenue: entity.curfew_venue,
      showLength: entity.show_length,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }
}
