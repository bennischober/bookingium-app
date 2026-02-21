import { deal_memo, band, venue } from '../../db/schema'
import type { DealMemoListItemDto, DealMemoDto } from '../schemas/deal_memo.schema'

type DealMemoEntity = typeof deal_memo.$inferSelect
type BandEntity = typeof band.$inferSelect
type VenueEntity = typeof venue.$inferSelect

type DealMemoWithRelations = DealMemoEntity & {
  band?: BandEntity | null
  venue?: VenueEntity | null
}

export class DealMemoMapper {
  static toListItemDto(entity: DealMemoWithRelations): DealMemoListItemDto {
    return {
      id: entity.id,
      deal: entity.deal,
      date: entity.date,
      status: entity.status,
      bandId: entity.band_id,
      bandName: entity.band?.name ?? 'Unknown',
      venueId: entity.venue_id,
      venueName: entity.venue?.name ?? null
    }
  }

  static toListItemDtoList(entities: DealMemoWithRelations[]): DealMemoListItemDto[] {
    return entities.map((e) => this.toListItemDto(e))
  }

  static toDto(entity: DealMemoWithRelations): DealMemoDto {
    return {
      ...this.toListItemDto(entity),
      ticketPriceVvk: entity.ticket_price_vvk,
      ticketPriceAk: entity.ticket_price_ak,
      posters: entity.posters,
      notes: entity.notes,
      amountOfPeople: entity.amount_of_people,
      roomInformation: entity.room_information,
      performanceDuration: entity.performance_duration,
      performanceTime: entity.performance_time,
      performanceInformation: entity.performance_information,
      loProPersonId: entity.lopro_person_id,
      loProCompanyId: entity.lopro_company_id,
      hotelId: entity.hotel_id,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }
}
