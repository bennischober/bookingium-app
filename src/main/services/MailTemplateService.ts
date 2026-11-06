import { injectable, inject } from 'tsyringe'
import { MailTemplateRepository } from '../repositories/MailTemplateRepository'
import type { MailTemplateDto, SaveMailTemplateInput } from '../api/schemas/mailTemplate.schema'
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
