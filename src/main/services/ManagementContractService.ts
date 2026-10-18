import { inject, injectable } from 'tsyringe'
import { ManagementContractRepository } from '../repositories/ManagementContractRepository'
import type { UpdateManagementContractInput } from '../api/schemas/management_contract.schema'

@injectable()
export class ManagementContractService {
  constructor(
    @inject(ManagementContractRepository) private repository: ManagementContractRepository
  ) {}

  async listByBand(bandId: number) {
    return await this.repository.listByBand(bandId)
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
}
