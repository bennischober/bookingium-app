import { inject, injectable } from 'tsyringe'
import { DocumentLinkRepository } from '../repositories/DocumentLinkRepository'
import { DocumentRepository } from '../repositories/DocumentRepository'
import { DocumentMapper } from '../api/mappers/document.mapper'
import type {
  DocumentLinkDto,
  RelatedDocumentDto,
  SetDocumentLinkInput
} from '../api/schemas/document_link.schema'
import type { DocumentOwnerType } from '../api/schemas/document.schema'

/** Further records a document belongs to, and the documents that concern a record */
@injectable()
export class DocumentLinkService {
  constructor(
    @inject(DocumentLinkRepository) private links: DocumentLinkRepository,
    @inject(DocumentRepository) private documents: DocumentRepository
  ) {}

  list(documentId: number): DocumentLinkDto[] {
    return this.links.links(documentId)
  }

  /** Links or unlinks; the document's own owner is never linked to it a second time */
  async set(input: SetDocumentLinkInput): Promise<DocumentLinkDto[]> {
    const document = await this.documents.getById(input.documentId)
    if (!document) throw new Error('Dokument nicht gefunden')
    const isOwner = document.owner_type === input.kind && document.owner_id === input.id
    if (!isOwner) {
      if (input.linked && this.links.labels(input.kind, [input.id]).size === 0)
        throw new Error('Eintrag nicht gefunden')
      this.links.setLink(input.documentId, input.kind, input.id, input.linked)
    }
    return this.links.links(input.documentId)
  }

  /** Links several records at once (contract import); unknown ids are skipped */
  linkAll(documentId: number, targets: Array<{ kind: DocumentOwnerType; id: number }>): void {
    for (const target of targets) {
      if (this.links.labels(target.kind, [target.id]).size === 0) continue
      this.links.setLink(documentId, target.kind, target.id, true)
    }
  }

  related(kind: DocumentOwnerType, id: number): RelatedDocumentDto[] {
    return this.links.related(kind, id).map(({ document, via, source }) => ({
      ...DocumentMapper.toDto(document),
      via,
      source
    }))
  }

  searchTargets(query: string): DocumentLinkDto[] {
    return this.links.searchTargets(query)
  }
}
