import { person, address as addressTable, contact as contactTable } from '../../db/schema'
import type { PersonDto, PersonListItemDto } from '../schemas/person.schema'
import { AddressMapper } from './address.mapper'
import { ContactMapper } from './contact.mapper'

type PersonEntity = typeof person.$inferSelect
type AddressEntity = typeof addressTable.$inferSelect
type ContactEntity = typeof contactTable.$inferSelect

type PersonWithRelations = PersonEntity & {
  address?: AddressEntity | null
  contact?: ContactEntity | null
}

export class PersonMapper {
  static toDto(entity: PersonWithRelations): PersonDto {
    return {
      id: entity.id,
      firstName: entity.first_name,
      lastName: entity.last_name,
      birthday: entity.birthday,
      notes: entity.notes,
      address: AddressMapper.toDto(entity.address),
      contact: ContactMapper.toDto(entity.contact),
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: PersonWithRelations[]): PersonDto[] {
    return entities.map((entity) => this.toDto(entity))
  }

  static toListItem(entity: PersonEntity): PersonListItemDto {
    return {
      id: entity.id,
      firstName: entity.first_name,
      lastName: entity.last_name
    }
  }

  static toListItemList(entities: PersonEntity[]): PersonListItemDto[] {
    return entities.map((entity) => this.toListItem(entity))
  }
}
