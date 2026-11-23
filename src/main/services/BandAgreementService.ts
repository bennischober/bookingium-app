import { inject, injectable } from 'tsyringe'
import { BandAgreementRepository } from '../repositories/BandAgreementRepository'
import type {
  CreateBandAgreementInput,
  UpdateBandAgreementInput
} from '../api/schemas/band_agreement.schema'

/** Publishing and label agreements of a band */
@injectable()
export class BandAgreementService {
  constructor(@inject(BandAgreementRepository) private repository: BandAgreementRepository) {}

  async listByBand(bandId: number) {
    return await this.repository.listByBand(bandId)
  }

  async create(input: CreateBandAgreementInput) {
    return await this.repository.create(input)
  }

  async update(input: UpdateBandAgreementInput) {
    return await this.repository.update(input)
  }

  async delete(id: number) {
    await this.repository.delete(id)
  }

  async getPrintData(id: number) {
    return await this.repository.getPrintData(id)
  }
}
