import { CompanyDto, CompanyListItemDto } from '../schemas/company.schema'
import { company, address as addressTable, bank as bankTable } from '../../db/schema'
import { AddressMapper } from './address.mapper'
import { ContactMapper, type ContactEntity } from './contact.mapper'
import { BankMapper } from './bank.mapper'

type CompanyEntity = typeof company.$inferSelect
type AddressEntity = typeof addressTable.$inferSelect
type BankEntity = typeof bankTable.$inferSelect

type CompanyWithRelations = CompanyEntity & {
  address?: AddressEntity | null
  contact?: ContactEntity | null
  bank?: BankEntity | null
}

export class CompanyMapper {
  static toDto(entity: CompanyWithRelations): CompanyDto {
    return {
      id: entity.id,
      name: entity.name,
      notes: entity.notes ?? '',
      vatNumber: entity.vat_number,
      ustNumber: entity.ust_number,
      taxNumber: entity.tax_number,
      commercialRegisterNo: entity.commercial_register_no,
      registerCourt: entity.register_court,
      logoPath: entity.logo_path,
      signaturePath: entity.signature_path,
      kskNumber: entity.ksk_number,
      isDefaultForInvoicing: entity.is_default_for_invoicing,
      invoiceContactPersonId: entity.invoice_contact_person_id,
      address: AddressMapper.toDto(entity.address),
      contact: ContactMapper.toDto(entity.contact),
      bank: entity.bank ? BankMapper.toDto(entity.bank) : null,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: CompanyWithRelations[]): CompanyDto[] {
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
