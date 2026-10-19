import { injectable, inject } from 'tsyringe'
import { removeOwnerFolder } from '../utils/documentStorage'
import { DealMemoRepository } from '../repositories/DealMemoRepository'
import type { CreateDealMemoInput, UpdateDealMemoInput } from '../api/schemas/deal_memo.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class DealMemoService {
  constructor(@inject(DealMemoRepository) private dealMemoRepository: DealMemoRepository) {}

  async getAllDealMemosPaginated(pagination: PaginationInput) {
    return await this.dealMemoRepository.getAllPaginated(pagination)
  }

  async getDealMemoById(id: number) {
    return await this.dealMemoRepository.getById(id)
  }

  async createDealMemo(input: CreateDealMemoInput) {
    return await this.dealMemoRepository.create(input)
  }

  async updateDealMemo(input: UpdateDealMemoInput) {
    return await this.dealMemoRepository.update(input)
  }

  async deleteDealMemo(id: number) {
    await this.dealMemoRepository.delete(id)
    // Rows go with the owner (trigger); the files are removed here
    await removeOwnerFolder('event', id).catch((error) => console.error(error))
  }
}
