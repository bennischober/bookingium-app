import { injectable, inject } from 'tsyringe'
import { BandRepository } from '../repositories/BandRepository'

@injectable()
export class BandService {
  constructor(
    @inject(BandRepository)
    private bandRepository: BandRepository
  ) {}

  async getAllBands() {
    return await this.bandRepository.getAll()
  }
}
