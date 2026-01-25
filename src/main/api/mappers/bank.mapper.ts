import { bank } from '../../db/schema'
import type { BankDto, BankListItemDto } from '../schemas/bank.schema'

type BankEntity = typeof bank.$inferSelect

export class BankMapper {
  static toDto(entity: BankEntity): BankDto {
    return {
      id: entity.id,
      bankName: entity.bank_name,
      accountHolder: entity.account_holder,
      iban: entity.iban,
      bic: entity.bic
    }
  }

  static toDtoList(entities: BankEntity[]): BankDto[] {
    return entities.map((entity) => this.toDto(entity))
  }

  static toListItem(entity: BankEntity): BankListItemDto {
    return {
      id: entity.id,
      bankName: entity.bank_name,
      accountHolder: entity.account_holder
    }
  }

  static toListItemList(entities: BankEntity[]): BankListItemDto[] {
    return entities.map((entity) => this.toListItem(entity))
  }
}
