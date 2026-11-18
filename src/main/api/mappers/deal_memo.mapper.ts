import { deal_memo, deal_memo_deposit, band, venue, person, company, hotel } from '../../db/schema'
import { fromCents, fromNullableCents } from '../../einvoice/amounts'
import type {
  DealMemoListItemDto,
  DealMemoDto,
  DealMemoDetailDto
} from '../schemas/deal_memo.schema'

type DealMemoEntity = typeof deal_memo.$inferSelect
type BandEntity = typeof band.$inferSelect & { genres?: string }
type VenueEntity = typeof venue.$inferSelect
type PersonEntity = typeof person.$inferSelect
type CompanyEntity = typeof company.$inferSelect
type HotelEntity = typeof hotel.$inferSelect
type DepositEntity = typeof deal_memo_deposit.$inferSelect

type DealMemoWithRelations = DealMemoEntity & {
  band?: BandEntity | null
  venue?: VenueEntity | null
  hotel?: HotelEntity | null
  loProPerson?: PersonEntity | null
  loProCompany?: CompanyEntity | null
  deposits?: DepositEntity[]
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
      venueName: entity.venue?.name ?? null,
      tour: entity.tour
    }
  }

  static toListItemDtoList(entities: DealMemoWithRelations[]): DealMemoListItemDto[] {
    return entities.map((e) => this.toListItemDto(e))
  }

  static toDto(entity: DealMemoWithRelations): DealMemoDto {
    return {
      ...this.toListItemDto(entity),
      ticketPriceVvk: fromNullableCents(entity.ticket_price_vvk_cents),
      ticketPriceAk: fromNullableCents(entity.ticket_price_ak_cents),
      posters: entity.posters,
      notes: entity.notes,
      amountOfPeople: entity.amount_of_people,
      roomInformation: entity.room_information,
      performanceDuration: entity.performance_duration,
      performanceTime: entity.performance_time,
      performanceInformation: entity.performance_information,
      guaranteeAmount: fromNullableCents(entity.guarantee_cents),
      guaranteeVatRate: entity.guarantee_vat_rate,
      deposits: (entity.deposits ?? []).map((d) => ({
        amount: fromCents(d.amount_cents),
        dueDate: d.due_date,
        paidAt: d.paid_at
      })),
      contractNotes: entity.contract_notes ?? '',
      contractSentAt: entity.contract_sent_at,
      contractReturnedAt: entity.contract_returned_at,
      loProPersonId: entity.lopro_person_id,
      loProCompanyId: entity.lopro_company_id,
      invoiceCompanyId: entity.invoice_company_id,
      representingCompanyId: entity.representing_company_id,
      hotelId: entity.hotel_id,
      radiusKm: entity.radius_km,
      radiusWeeksBefore: entity.radius_weeks_before,
      radiusWeeksAfter: entity.radius_weeks_after,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDetailDto(entity: DealMemoWithRelations): DealMemoDetailDto {
    return {
      ...this.toDto(entity),
      band: entity.band
        ? {
            id: entity.band.id,
            name: entity.band.name,
            genre: entity.band.genres ?? '',
            managementCompanyId: entity.band.management_company_id
          }
        : null,
      venue: entity.venue
        ? {
            id: entity.venue.id,
            name: entity.venue.name,
            capacity: entity.venue.capacity,
            kind: entity.venue.kind === 'festival' ? 'festival' : 'venue',
            radiusKm: entity.venue.radius_km,
            radiusWeeksBefore: entity.venue.radius_weeks_before,
            radiusWeeksAfter: entity.venue.radius_weeks_after
          }
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
