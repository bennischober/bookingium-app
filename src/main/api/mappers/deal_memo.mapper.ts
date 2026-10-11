import { deal_memo, band, venue, person, company, hotel } from '../../db/schema'
import type {
  DealMemoListItemDto,
  DealMemoDto,
  DealMemoDetailDto
} from '../schemas/deal_memo.schema'

type DealMemoEntity = typeof deal_memo.$inferSelect
type BandEntity = typeof band.$inferSelect
type VenueEntity = typeof venue.$inferSelect
type PersonEntity = typeof person.$inferSelect
type CompanyEntity = typeof company.$inferSelect
type HotelEntity = typeof hotel.$inferSelect

type DealMemoWithRelations = DealMemoEntity & {
  band?: BandEntity | null
  venue?: VenueEntity | null
  hotel?: HotelEntity | null
  loProPerson?: PersonEntity | null
  loProCompany?: CompanyEntity | null
}

export class DealMemoMapper {
  static toListItemDto(entity: DealMemoWithRelations): DealMemoListItemDto {
    return {
      id: entity.id,
      name: entity.name,
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
      guaranteeAmount: entity.guarantee_amount,
      guaranteeVatRate: entity.guarantee_vat_rate,
      contractNotes: entity.contract_notes ?? '',
      loProPersonId: entity.lopro_person_id,
      loProCompanyId: entity.lopro_company_id,
      invoiceCompanyId: entity.invoice_company_id,
      hotelId: entity.hotel_id,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDetailDto(entity: DealMemoWithRelations): DealMemoDetailDto {
    return {
      ...this.toDto(entity),
      band: entity.band
        ? { id: entity.band.id, name: entity.band.name, genre: entity.band.genre }
        : null,
      venue: entity.venue
        ? { id: entity.venue.id, name: entity.venue.name, capacity: entity.venue.capacity }
        : null,
      hotel: entity.hotel ? { id: entity.hotel.id, name: entity.hotel.name } : null,
      loProPerson: entity.loProPerson
        ? {
            id: entity.loProPerson.id,
            firstName: entity.loProPerson.first_name,
            lastName: entity.loProPerson.last_name
          }
        : null,
      loProCompany: entity.loProCompany
        ? { id: entity.loProCompany.id, name: entity.loProCompany.name }
        : null
    }
  }
}
