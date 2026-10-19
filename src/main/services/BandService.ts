import { injectable, inject } from 'tsyringe'
import { removeOwnerFolder } from '../utils/documentStorage'
import { BandRepository } from '../repositories/BandRepository'
import { CreateBandInput, UpdateBandInput } from '../api/schemas/band.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class BandService {
  constructor(
    @inject(BandRepository)
    private bandRepository: BandRepository
  ) {}

  async getAllBands() {
    return await this.bandRepository.getAll()
  }

  async getAllBandsPaginated(pagination: PaginationInput) {
    return await this.bandRepository.getAllPaginated(pagination)
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

  async deleteBand(id: number) {
    const deleted = await this.bandRepository.delete(id)
    await removeOwnerFolder('band', id).catch((error) => console.error(error))
    return deleted
  }
}
