import { BandDto, BandListItemDto } from '../schemas/band.schema'
import { band } from '../../db/schema'

type BandRow = typeof band.$inferSelect
/** The repositories add the tags from band_genre (#152) */
type BandEntity = BandRow & { genres: string }

export class BandMapper {
  static toDto(entity: BandEntity): BandDto {
    return {
      id: entity.id,
      name: entity.name,
      genre: entity.genres,
      founded: entity.founded,
      notes: entity.notes,
      companyId: entity.company_id,
      responsiblePersonId: entity.responsible_person_id,
      managementCompanyId: entity.management_company_id,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: BandEntity[]): BandDto[] {
    return entities.map((entity) => this.toDto(entity))
  }

  static toListItem(entity: BandRow): BandListItemDto {
    return { id: entity.id, name: entity.name }
  }

  static toListItemList(entities: BandRow[]): BandListItemDto[] {
    return entities.map((entity) => this.toListItem(entity))
  }
}
