import { inject, injectable } from 'tsyringe'
import { AdvancingRepository, type PersonRow } from '../repositories/AdvancingRepository'
import { utilizationPercent } from '../advancing/advancing'
import {
  AdvancingStatus,
  type PersonRefDto,
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
