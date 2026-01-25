import { injectable, inject } from 'tsyringe'
import { VenueRepository } from '../repositories/VenueRepository'
import type { CreateVenueInput, UpdateVenueInput } from '../api/schemas/venue.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class VenueService {
  constructor(@inject(VenueRepository) private venueRepository: VenueRepository) {}

  async getAllVenues() {
    return await this.venueRepository.getAll()
  }

  async getAllVenuesPaginated(pagination: PaginationInput) {
    return await this.venueRepository.getAllPaginated(pagination)
  }

  async getVenueById(id: number) {
    return await this.venueRepository.getById(id)
  }

  async createVenue(input: CreateVenueInput) {
    return await this.venueRepository.create(input)
  }

  async updateVenue(input: UpdateVenueInput) {
    return await this.venueRepository.update(input)
  }

  async deleteVenue(id: number) {
    await this.venueRepository.delete(id)
  }
}
