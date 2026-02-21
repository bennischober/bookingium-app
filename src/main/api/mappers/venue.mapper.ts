import { venue } from '../../db/schema'
import type { VenueDto, VenueListItemDto } from '../schemas/venue.schema'

type VenueEntity = typeof venue.$inferSelect

export class VenueMapper {
  static toDto(entity: VenueEntity): VenueDto {
    return {
      id: entity.id,
      name: entity.name,
      capacity: entity.capacity,
      notes: entity.notes,
      addressId: entity.address_id ?? null,
      companyId: entity.company_id ?? null,
      contactId: entity.contact_id ?? null,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: VenueEntity[]): VenueDto[] {
    return entities.map((entity) => this.toDto(entity))
  }

  static toListItem(entity: VenueEntity): VenueListItemDto {
    return {
      id: entity.id,
      name: entity.name
    }
  }

  static toListItemList(entities: VenueEntity[]): VenueListItemDto[] {
    return entities.map((entity) => this.toListItem(entity))
  }
}
