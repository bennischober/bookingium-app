import { injectable, inject } from 'tsyringe'
import { scheduleCalendarUpdate } from './CalendarFeedService'
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

  async listBandsByCompany(companyId: number) {
    return await this.bandRepository.listByCompany(companyId)
  }

  async listBandsByResponsiblePerson(personId: number) {
    return await this.bandRepository.listByResponsiblePerson(personId)
  }

  async updateBand(data: UpdateBandInput) {
    const result = await this.bandRepository.update(data)
    scheduleCalendarUpdate()
    return result
  }

  async deleteBand(id: number) {
    const deleted = await this.bandRepository.delete(id)
    await removeOwnerFolder('band', id).catch((error) => console.error(error))
    scheduleCalendarUpdate()
    return deleted
  }
}
