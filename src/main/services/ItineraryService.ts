import { injectable, inject } from 'tsyringe'
import { ItineraryRepository } from '../repositories/ItineraryRepository'
import type { UpsertItineraryInput } from '../api/schemas/itinerary.schema'

@injectable()
export class ItineraryService {
  constructor(@inject(ItineraryRepository) private itineraryRepository: ItineraryRepository) {}

  async getByDealMemoId(dealMemoId: number) {
    return await this.itineraryRepository.getByDealMemoId(dealMemoId)
  }

  async upsert(input: UpsertItineraryInput) {
    return await this.itineraryRepository.upsert(input)
  }

  async delete(dealMemoId: number) {
    await this.itineraryRepository.delete(dealMemoId)
  }
}
