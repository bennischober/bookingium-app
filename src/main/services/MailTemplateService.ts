import { injectable, inject } from 'tsyringe'
import { MailTemplateRepository } from '../repositories/MailTemplateRepository'
import type {
  DocumentTemplateDto,
  DocumentTemplateRef,
  MailTemplateDto,
  SaveDocumentTemplateInput,
  SaveMailTemplateInput
} from '../api/schemas/mailTemplate.schema'
import {
  DEFAULT_DOCUMENT_EMAILS,
  type EmailTemplate,
  type EmailTemplateKind
} from '../api/schemas/settings.schema'
import type { MailTemplateEvent } from '../mail/mailTemplate'

type Row = NonNullable<ReturnType<MailTemplateRepository['insert']>>

const toDto = (row: Row): MailTemplateDto => ({
  id: row.id,
  name: row.name,
  subject: row.subject,
  body: row.body
})

// #123: the user's own mail templates (E-Mail-Vorlagen)
@injectable()
export class MailTemplateService {
  constructor(@inject(MailTemplateRepository) private repository: MailTemplateRepository) {}

  list(): MailTemplateDto[] {
    return this.repository.list().map(toDto)
  }

  save(input: SaveMailTemplateInput): MailTemplateDto {
    const row =
      input.id !== undefined
        ? this.repository.update(input.id, input.name, input.subject, input.body)
        : this.repository.insert(input.name, input.subject, input.body)
    if (!row) throw new Error('Vorlage nicht gefunden')
    return toDto(row)
  }

  delete(id: number): void {
    this.repository.delete(id)
  }

  /** #136: the eight fixed texts, edited or default, in a fixed order */
  documents(): DocumentTemplateDto[] {
    const edited = new Map(
      this.repository.documents().map((row) => [`${row.kind}:${row.lang}`, row])
    )
    return (Object.keys(DEFAULT_DOCUMENT_EMAILS) as EmailTemplateKind[]).flatMap((kind) =>
      (['de', 'en'] as const).map((lang) => {
        const row = edited.get(`${kind}:${lang}`)
        const text = row ?? DEFAULT_DOCUMENT_EMAILS[kind][lang]
        return { kind, lang, subject: text.subject, body: text.body, edited: row !== undefined }
      })
    )
  }

  /** The text "Per E-Mail senden" fills: the edited one, else the default */
  documentTemplate(kind: EmailTemplateKind, lang: 'de' | 'en'): EmailTemplate {
    const row = this.repository.document(kind, lang)
    return row ? { subject: row.subject, body: row.body } : DEFAULT_DOCUMENT_EMAILS[kind][lang]
  }

  saveDocument(input: SaveDocumentTemplateInput): void {
    this.repository.saveDocument(input.kind, input.lang, input.subject, input.body)
  }

  resetDocument(input: DocumentTemplateRef): void {
    this.repository.resetDocument(input.kind, input.lang)
  }

  /** What the placeholders need from an event; null if it is gone */
  event(id: number): MailTemplateEvent | null {
    const row = this.repository.event(id)
    if (!row) return null
    const person = [row.loproFirstName, row.loproLastName].filter(Boolean).join(' ').trim()
    return {
      name: row.name,
      date: row.date,
      performanceTime: row.performanceTime ?? '',
      band: row.band,
      venue: row.venue ?? '',
      city: row.city ?? '',
      lopro: person || (row.loproCompany ?? '')
    }
  }
}
