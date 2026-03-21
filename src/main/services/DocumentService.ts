import { injectable, inject } from 'tsyringe'
import { DocumentRepository } from '../repositories/DocumentRepository'
import type { CreateDocumentInput, UpdateDocumentInput } from '../api/schemas/document.schema'

@injectable()
export class DocumentService {
  constructor(@inject(DocumentRepository) private documentRepository: DocumentRepository) {}

  async getByDealMemoId(dealMemoId: number) {
    return await this.documentRepository.getByDealMemoId(dealMemoId)
  }

  async getById(id: number) {
    return await this.documentRepository.getById(id)
  }

  async createDocument(input: CreateDocumentInput) {
    return await this.documentRepository.create(input)
  }

  async updateDocument(input: UpdateDocumentInput) {
    return await this.documentRepository.update(input)
  }

  async deleteDocument(id: number) {
    const doc = await this.getById(id)
    if (doc) {
      await this.documentRepository.delete(id)
    }
    return doc
  }

  async deleteDocumentByFilePath(filePath: string) {
    await this.documentRepository.deleteByFilePath(filePath)
  }
}
