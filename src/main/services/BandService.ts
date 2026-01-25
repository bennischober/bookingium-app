import { injectable, inject } from 'tsyringe'
import { BandRepository } from '../repositories/BandRepository'
import { CreateBandInput, UpdateBandInput } from '../api/schemas/band.schema'

@injectable()
export class BandService {
  constructor(
    @inject(BandRepository)
    private bandRepository: BandRepository
  ) {}

  async getAllBands() {
    return await this.bandRepository.getAll()
  }

  async getBandById(id: number) {
    return await this.bandRepository.getById(id)
  }

  async createBand(data: CreateBandInput) {
    return await this.bandRepository.create(data)
  }

  async updateBand(data: UpdateBandInput) {
    return await this.bandRepository.update(data)
  }
}
