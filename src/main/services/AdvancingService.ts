import { inject, injectable } from 'tsyringe'
import { AdvancingRepository, type PersonRow } from '../repositories/AdvancingRepository'
import { utilizationPercent } from '../advancing/advancing'
import { soldInText, suggestedStage } from '../advancing/advancingMail'
import { GENERIC_DOMAINS } from '../mail/genericDomains'
import {
  AdvancingStatus,
  type LocalContactFromMailInput,
  type MailShowDto,
  type MailShowsInput,
  type PersonRefDto,
  type SetStageInput,
  type SaveAdvancingInput,
  type SaveTicketQuotaInput,
  type SaveTicketReportInput,
  type ShowAdvancingDto,
  type TourOverviewInput,
  type TourShowDto
} from '../api/schemas/advancing.schema'

// #232: advancing and tickets of a show, and the tour overview of both

const personRef = (row: PersonRow | undefined): PersonRefDto | null =>
  row
    ? {
        id: row.id,
        name: [row.firstName, row.lastName].filter(Boolean).join(' '),
        email: row.email ?? '',
        phone: row.mobile || row.phone || ''
      }
    : null

@injectable()
export class AdvancingService {
  constructor(@inject(AdvancingRepository) private repository: AdvancingRepository) {}

  /** Advancing and tickets of shows, by event id; shows without rows get the empty state */
  private shows(eventIds: number[]): Map<number, Omit<ShowAdvancingDto, 'suggestedContact'>> {
    const advancing = new Map(this.repository.advancingOf(eventIds).map((r) => [r.deal_memo_id, r]))
    const quotas = new Map(this.repository.quotasOf(eventIds).map((r) => [r.deal_memo_id, r]))
    const reports = new Map<number, ShowAdvancingDto['reports']>()
    for (const report of this.repository.reportsOf(eventIds)) {
      const list = reports.get(report.deal_memo_id) ?? []
      list.push({
        id: report.id,
        reportDate: report.report_date,
        sold: report.sold,
        note: report.note
      })
      reports.set(report.deal_memo_id, list)
    }
    const contactIds = [...advancing.values()].flatMap((r) =>
      r.local_contact_id ? [r.local_contact_id] : []
    )
    const persons = new Map(this.repository.persons(contactIds).map((p) => [p.id, p]))

    return new Map(
      eventIds.map((eventId) => {
        const row = advancing.get(eventId)
        const quota = quotas.get(eventId)
        const list = reports.get(eventId) ?? []
        const sold = list[0]?.sold ?? null
        const status = AdvancingStatus.safeParse(row?.status)
        return [
          eventId,
          {
            eventId,
            status: status.success ? status.data : 'open',
            statusDate: row?.status_date ?? null,
            localContact: personRef(
              row?.local_contact_id ? persons.get(row.local_contact_id) : undefined
            ),
            notes: row?.notes ?? '',
            quota: quota?.quota ?? null,
            quotaNote: quota?.quota_note ?? '',
            reports: list,
            sold,
            utilization: utilizationPercent(sold, quota?.quota ?? null)
          }
        ]
      })
    )
  }

  get(eventId: number): ShowAdvancingDto {
    if (!this.repository.eventExists(eventId)) throw new Error('Event nicht gefunden')
    const show = this.shows([eventId]).get(eventId)!
    let suggestedContact: PersonRefDto | null = null
    if (!show.localContact) {
      const id = this.repository.previousLocalContactId(eventId)
      if (id) suggestedContact = personRef(this.repository.persons([id])[0])
    }
    return { ...show, suggestedContact }
  }

  saveAdvancing(input: SaveAdvancingInput): ShowAdvancingDto {
    if (!this.repository.eventExists(input.eventId)) throw new Error('Event nicht gefunden')
    this.repository.saveAdvancing({ ...input, notes: input.notes.trim() })
    if (input.localContactId) this.repository.rememberAtVenue(input.eventId, input.localContactId)
    return this.get(input.eventId)
  }

  saveQuota(input: SaveTicketQuotaInput): ShowAdvancingDto {
    if (!this.repository.eventExists(input.eventId)) throw new Error('Event nicht gefunden')
    this.repository.saveQuota({ ...input, quotaNote: input.quotaNote.trim() })
    return this.get(input.eventId)
  }

  saveReport(input: SaveTicketReportInput): ShowAdvancingDto {
    if (!this.repository.eventExists(input.eventId)) throw new Error('Event nicht gefunden')
    this.repository.saveReport({ ...input, note: input.note.trim() })
    return this.get(input.eventId)
  }

  deleteReport(id: number): void {
    this.repository.deleteReport(id)
  }

  /** #235: only the stage changes (from a mail); today is the day it was reached */
  setStage(input: SetStageInput, today = new Date().toISOString().slice(0, 10)): ShowAdvancingDto {
    const show = this.get(input.eventId)
    return this.saveAdvancing({
      eventId: input.eventId,
      status: input.status,
      statusDate: input.status === show.status ? show.statusDate : today,
      localContactId: show.localContact?.id ?? null,
      notes: show.notes
    })
  }

  /** #235: the advancing mail went out - a show not yet further is now "angeschrieben" */
  markContacted(eventId: number, today = new Date().toISOString().slice(0, 10)): void {
    const status = this.repository.statusOf(eventId)
    if (status === null || status === 'open') this.setStage({ eventId, status: 'contacted' }, today)
  }

  /** #235: the mail's sender becomes the show's contact on site (found or created by e-mail) */
  localContactFromMail(input: LocalContactFromMailInput): ShowAdvancingDto {
    const show = this.get(input.eventId)
    const personId = this.repository.personForEmail(input.email, input.name)
    return this.saveAdvancing({
      eventId: input.eventId,
      status: show.status,
      statusDate: show.statusDate,
      localContactId: personId,
      notes: show.notes
    })
  }

  /**
   * #235: the shows a mail belongs to - linked to it, or from (or to) the promoter's contact,
   * the promoter or the contact on site - from a week ago to three months ahead, with what the
   * mail suggests: the next stage, a ticket count
   */
  forMail(input: MailShowsInput, today = new Date().toISOString().slice(0, 10)): MailShowDto[] {
    const emails = [input.fromEmail, ...input.toEmails]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
    const domains = [...new Set(emails.map((email) => email.split('@')[1] ?? ''))].filter(
      (domain) => domain && !GENERIC_DOMAINS.has(domain)
    )
    const shift = (days: number): string => {
      const date = new Date(`${today}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + days)
      return date.toISOString().slice(0, 10)
    }
    const bare = (input.messageId ?? '').trim().replace(/^</, '').replace(/>$/, '')
    const rows = this.repository.showsForMail({
      emails,
      domains,
      linkedEventIds: this.repository.linkedEventIds(input.accountId, bare),
      from: shift(-7),
      to: shift(90)
    })
    if (rows.length === 0) return []
    const shows = this.shows(rows.map((row) => row.id))
    const sender = input.fromEmail.trim().toLowerCase()
    const sold = soldInText(`${input.subject}\n${input.snippet}`)
    return rows.map((row) => {
      const show = shows.get(row.id)!
      const info = this.repository.showOf(row.id)
      return {
        eventId: row.id,
        date: row.date,
        label: [info?.bandName, [info?.venueName, info?.city].filter(Boolean).join(', ')]
          .filter(Boolean)
          .join(' – '),
        status: show.status,
        statusDate: show.statusDate,
        suggestedStatus: suggestedStage(show.status),
        suggestedSold: sold !== null && sold !== show.sold ? sold : null,
        quota: show.quota,
        sold: show.sold,
        localContact: show.localContact,
        senderIsLocalContact: show.localContact?.email.toLowerCase() === sender
      }
    })
  }

  /** Every show of a tour with its advancing and tickets, by date */
  tour(input: TourOverviewInput): TourShowDto[] {
    const rows = this.repository.tourShows(input.tour, input.bandId)
    const shows = this.shows(rows.map((row) => row.id))
    return rows.map((row) => {
      const show = shows.get(row.id)!
      return {
        ...show,
        date: row.date,
        bandName: row.bandName ?? '',
        venueName: row.venueName ?? '',
        city: row.city ?? '',
        eventStatus: row.status,
        promoterName: row.promoterName ?? '',
        previousSold: show.reports[1]?.sold ?? null
      }
    })
  }
}
