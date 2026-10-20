import { inject, injectable } from 'tsyringe'
import { ManagementContractRepository } from '../repositories/ManagementContractRepository'
import { ManagementShareRepository } from '../repositories/ManagementShareRepository'
import type {
  CreateManagementShareInput,
  UpdateManagementContractInput
} from '../api/schemas/management_contract.schema'

@injectable()
export class ManagementContractService {
  constructor(
    @inject(ManagementContractRepository) private repository: ManagementContractRepository,
    @inject(ManagementShareRepository) private shares: ManagementShareRepository
  ) {}

  async listByBand(bandId: number) {
    return await this.repository.listByBand(bandId)
  }

  async listByPerson(personId: number) {
    return await this.repository.listByPerson(personId)
  }

  async createForBand(bandId: number) {
    return await this.repository.createForBand(bandId)
  }

  async update(input: UpdateManagementContractInput) {
    if (input.representativePersonId && input.memberPersonIds) {
      if (!input.memberPersonIds.includes(input.representativePersonId)) {
        throw new Error('Der Bevollmächtigte muss eines der aufgeführten Mitglieder sein')
      }
    }
    return await this.repository.update(input)
  }

  async delete(id: number) {
    await this.repository.delete(id)
  }

  async getPrintData(id: number) {
    return await this.repository.getPrintData(id)
  }

  /** Bills a quarter's management share as a draft invoice to the band */
  async createShare(input: CreateManagementShareInput) {
    return await this.shares.createForContract(input)
  }

  async listSharesByBand(bandId: number) {
    return await this.shares.listByBand(bandId)
  }
}
