import type {
  BandMemberDto,
  CompanyMemberDto,
  VenueMemberDto,
  PersonRelationsDto
} from '../schemas/relation.schema'

// Raw query result types from the repository
export type BandMemberQueryResult = {
  id: number
  bandId: number
  bandName: string
  personId: number
  personName: string
  role: string | null
  notes: string | null
}

export type CompanyMemberQueryResult = {
  id: number
  companyId: number
  companyName: string
  personId: number
  personName: string
  role: string | null
  notes: string | null
}

export type VenueMemberQueryResult = {
  id: number
  venueId: number
  venueName: string
  personId: number
  personName: string
  role: string | null
  notes: string | null
}

export type PersonRelationsQueryResult = {
  bands: BandMemberQueryResult[]
  companies: CompanyMemberQueryResult[]
  venues: VenueMemberQueryResult[]
}

export class RelationMapper {
  // ========================================
  // Band Member Mapping
  // ========================================
  static toBandMemberDto(entity: BandMemberQueryResult): BandMemberDto {
    return {
      id: entity.id,
      bandId: entity.bandId,
      bandName: entity.bandName,
      personId: entity.personId,
      personName: entity.personName,
      role: entity.role ?? '',
      notes: entity.notes ?? ''
    }
  }

  static toBandMemberDtoList(entities: BandMemberQueryResult[]): BandMemberDto[] {
    return entities.map((entity) => this.toBandMemberDto(entity))
  }

  // ========================================
  // Company Member Mapping
  // ========================================
  static toCompanyMemberDto(entity: CompanyMemberQueryResult): CompanyMemberDto {
    return {
      id: entity.id,
      companyId: entity.companyId,
      companyName: entity.companyName,
      personId: entity.personId,
      personName: entity.personName,
      role: entity.role ?? '',
      notes: entity.notes ?? ''
    }
  }

  static toCompanyMemberDtoList(entities: CompanyMemberQueryResult[]): CompanyMemberDto[] {
    return entities.map((entity) => this.toCompanyMemberDto(entity))
  }

  // ========================================
  // Venue Member Mapping
  // ========================================
  static toVenueMemberDto(entity: VenueMemberQueryResult): VenueMemberDto {
    return {
      id: entity.id,
      venueId: entity.venueId,
      venueName: entity.venueName,
      personId: entity.personId,
      personName: entity.personName,
      role: entity.role ?? '',
      notes: entity.notes ?? ''
    }
  }

  static toVenueMemberDtoList(entities: VenueMemberQueryResult[]): VenueMemberDto[] {
    return entities.map((entity) => this.toVenueMemberDto(entity))
  }

  // ========================================
  // Person Relations Mapping
  // ========================================
  static toPersonRelationsDto(data: PersonRelationsQueryResult): PersonRelationsDto {
    return {
      bands: this.toBandMemberDtoList(data.bands),
      companies: this.toCompanyMemberDtoList(data.companies),
      venues: this.toVenueMemberDtoList(data.venues)
    }
  }
}
