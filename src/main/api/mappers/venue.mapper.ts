import {
  venue,
  address as addressTable,
  contact as contactTable,
  company as companyTable
} from '../../db/schema'
import type { VenueDto, VenueListItemDto } from '../schemas/venue.schema'
import { AddressMapper } from './address.mapper'
import { ContactMapper } from './contact.mapper'

type VenueEntity = typeof venue.$inferSelect
type AddressEntity = typeof addressTable.$inferSelect
type ContactEntity = typeof contactTable.$inferSelect
type CompanyEntity = typeof companyTable.$inferSelect

type VenueWithRelations = VenueEntity & {
  address?: AddressEntity | null
  contact?: ContactEntity | null
  company?: CompanyEntity | null
}

export class VenueMapper {
  static toDto(entity: VenueWithRelations): VenueDto {
    return {
      id: entity.id,
      name: entity.name,
      capacity: entity.capacity,
      notes: entity.notes,
      address: AddressMapper.toDto(entity.address),
      contact: ContactMapper.toDto(entity.contact),
      company: entity.company
        ? {
            id: entity.company.id,
            name: entity.company.name
          }
        : null,
      addressId: entity.address_id ?? null,
      companyId: entity.company_id ?? null,
      contactId: entity.contact_id ?? null,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: VenueWithRelations[]): VenueDto[] {
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
