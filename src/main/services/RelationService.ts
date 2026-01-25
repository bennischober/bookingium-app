import { injectable, inject } from 'tsyringe'
import { RelationRepository } from '../repositories/RelationRepository'
import type {
  CreateBandMemberInput,
  UpdateBandMemberInput,
  CreateCompanyMemberInput,
  UpdateCompanyMemberInput,
  CreateVenueMemberInput,
  UpdateVenueMemberInput
} from '../api/schemas/relation.schema'

@injectable()
export class RelationService {
  constructor(@inject(RelationRepository) private relationRepository: RelationRepository) {}

  // ========================================
  // Person Relations
  // ========================================
  async getPersonRelations(personId: number) {
    return await this.relationRepository.getPersonRelations(personId)
  }

  // ========================================
  // Band Member Operations
  // ========================================
  async getBandMembers(bandId: number) {
    return await this.relationRepository.getBandMembers(bandId)
  }

  async addBandMember(input: CreateBandMemberInput) {
    return await this.relationRepository.addBandMember(input)
  }

  async updateBandMember(input: UpdateBandMemberInput) {
    return await this.relationRepository.updateBandMember(input)
  }

  async removeBandMember(id: number) {
    await this.relationRepository.removeBandMember(id)
  }

  // ========================================
  // Company Member Operations
  // ========================================
  async getCompanyMembers(companyId: number) {
    return await this.relationRepository.getCompanyMembers(companyId)
  }

  async addCompanyMember(input: CreateCompanyMemberInput) {
    return await this.relationRepository.addCompanyMember(input)
  }

  async updateCompanyMember(input: UpdateCompanyMemberInput) {
    return await this.relationRepository.updateCompanyMember(input)
  }

  async removeCompanyMember(id: number) {
    await this.relationRepository.removeCompanyMember(id)
  }

  // ========================================
  // Venue Member Operations
  // ========================================
  async getVenueMembers(venueId: number) {
    return await this.relationRepository.getVenueMembers(venueId)
  }

  async addVenueMember(input: CreateVenueMemberInput) {
    return await this.relationRepository.addVenueMember(input)
  }

  async updateVenueMember(input: UpdateVenueMemberInput) {
    return await this.relationRepository.updateVenueMember(input)
  }

  async removeVenueMember(id: number) {
    await this.relationRepository.removeVenueMember(id)
  }
}
