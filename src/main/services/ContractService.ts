import { inject, injectable } from 'tsyringe'
import { ContractRepository, type ContractData } from '../repositories/ContractRepository'

@injectable()
export class ContractService {
  constructor(@inject(ContractRepository) private contractRepository: ContractRepository) {}

  async getContractData(dealMemoId: number): Promise<ContractData | null> {
    return await this.contractRepository.getContractData(dealMemoId)
  }
}
