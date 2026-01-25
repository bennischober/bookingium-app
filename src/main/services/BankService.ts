import { injectable, inject } from 'tsyringe'
import { BankRepository } from '../repositories/BankRepository'
import type { CreateBankInput, UpdateBankInput } from '../api/schemas/bank.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class BankService {
  constructor(@inject(BankRepository) private bankRepository: BankRepository) {}

  async getAllBanks() {
    return await this.bankRepository.getAll()
  }

  async getAllBanksPaginated(pagination: PaginationInput) {
    return await this.bankRepository.getAllPaginated(pagination)
  }

  async getBankById(id: number) {
    return await this.bankRepository.getById(id)
  }

  async createBank(input: CreateBankInput) {
    return await this.bankRepository.create(input)
  }

  async updateBank(input: UpdateBankInput) {
    return await this.bankRepository.update(input)
  }

  async deleteBank(id: number) {
    await this.bankRepository.delete(id)
  }
}
