import { hotel, address as addressTable, contact as contactTable } from '../../db/schema'
import type { HotelDto, HotelListItemDto } from '../schemas/hotel.schema'
import { AddressMapper } from './address.mapper'
import { ContactMapper } from './contact.mapper'

type HotelEntity = typeof hotel.$inferSelect
type AddressEntity = typeof addressTable.$inferSelect
type ContactEntity = typeof contactTable.$inferSelect

type HotelWithRelations = HotelEntity & {
  address?: AddressEntity | null
  contact?: ContactEntity | null
}

export class HotelMapper {
  static toDto(entity: HotelWithRelations): HotelDto {
    return {
      id: entity.id,
      name: entity.name,
      notes: entity.notes ?? '',
      address: AddressMapper.toDto(entity.address),
      contact: ContactMapper.toDto(entity.contact),
      addressId: entity.address_id ?? null,
      contactId: entity.contact_id ?? null,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: HotelWithRelations[]): HotelDto[] {
    return entities.map((entity) => this.toDto(entity))
  }

  static toListItem(entity: HotelEntity): HotelListItemDto {
    return {
      id: entity.id,
      name: entity.name
    }
  }

  static toListItemList(entities: HotelEntity[]): HotelListItemDto[] {
    return entities.map((entity) => this.toListItem(entity))
  }
}
