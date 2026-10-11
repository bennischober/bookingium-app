import { BandDto, BandListItemDto } from '../schemas/band.schema'
import { band } from '../../db/schema'

type BandEntity = typeof band.$inferSelect

export class BandMapper {
  static toDto(entity: BandEntity): BandDto {
    return {
      id: entity.id,
      name: entity.name,
      genre: entity.genre,
      founded: entity.founded,
      notes: entity.notes,
      companyId: entity.company_id,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: BandEntity[]): BandDto[] {
    return entities.map((entity) => this.toDto(entity))
  }

  static toListItem(entity: BandEntity): BandListItemDto {
    return { id: entity.id, name: entity.name }
  }

  static toListItemList(entities: BandEntity[]): BandListItemDto[] {
    return entities.map((entity) => this.toListItem(entity))
  }
}
