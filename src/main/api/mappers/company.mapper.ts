import { CompanyDto, CompanyListItemDto } from '../schemas/company.schema'
import { company } from '../../db/schema'

type CompanyEntity = typeof company.$inferSelect

export class CompanyMapper {
  static toDto(entity: CompanyEntity): CompanyDto {
    return {
      id: entity.id,
      name: entity.name,
      notes: entity.notes,
      vatNumber: entity.vat_number,
      ustNumber: entity.ust_number,
      bankId: entity.bank_id,
      addressId: entity.address_id,
      contactId: entity.contact_id,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: CompanyEntity[]): CompanyDto[] {
    return entities.map(this.toDto)
  }

  static toListItem(entity: CompanyEntity): CompanyListItemDto {
    return {
      id: entity.id,
      name: entity.name
    }
  }

  static toListItemList(entities: CompanyEntity[]): CompanyListItemDto[] {
    return entities.map(this.toListItem)
  }
}
