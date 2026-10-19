import { injectable, inject } from 'tsyringe'
import { removeOwnerFolder } from '../utils/documentStorage'
import { VenueRepository } from '../repositories/VenueRepository'
import type {
  CreateVenueInput,
  UpdateVenueInput,
  VenuePaginationInput
} from '../api/schemas/venue.schema'

@injectable()
export class VenueService {
  constructor(@inject(VenueRepository) private venueRepository: VenueRepository) {}

  async getAllVenues() {
    return await this.venueRepository.getAll()
  }

  async getAllVenuesPaginated(pagination: VenuePaginationInput) {
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
    // Rows go with the owner (trigger); the files are removed here
    await removeOwnerFolder('venue', id).catch((error) => console.error(error))
  }
}
