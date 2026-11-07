import { injectable, inject } from 'tsyringe'
import { FollowUpRepository } from '../repositories/FollowUpRepository'
import { SettingsRepository } from '../repositories/SettingsRepository'
import { FollowUpMapper } from '../api/mappers/followUp.mapper'
import { scheduleCalendarUpdate } from './CalendarFeedService'
import type {
  CreateFollowUpInput,
  FollowUpDto,
  FollowUpHistoryDto,
  FollowUpRecordType,
  UpdateFollowUpInput
} from '../api/schemas/followUp.schema'

// Follow-ups (Wiedervorlagen): due dates with a note, on a record or general.
// Done ones stay in the table (done_at): "Rückgängig" and the history bring them back.
// Every change rewrites the calendar file soon, which lists open ones when set to (#52).
/** #142: app_setting key of the day the follow-up summary was last considered */
const SUMMARY_DAY_KEY = 'followUpSummaryDay'

@injectable()
export class FollowUpService {
  constructor(
    @inject(FollowUpRepository) private followUpRepository: FollowUpRepository,
    @inject(SettingsRepository) private settings: SettingsRepository
  ) {}

  /** #142: open follow-ups due on `today` (YYYY-MM-DD) or earlier, for the daily summary */
  countDue(today: string): number {
    return this.followUpRepository.countDue(today)
  }

  /** #142: the day the daily summary was last considered, or null */
  summaryDay(): string | null {
    const raw = this.settings.getAll()[SUMMARY_DAY_KEY]
    if (raw === undefined) return null
    try {
      const day = JSON.parse(raw) as unknown
      return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
    } catch {
      return null
    }
  }

  setSummaryDay(day: string): void {
    this.settings.setMany({ [SUMMARY_DAY_KEY]: JSON.stringify(day) })
  }

  listOpen(): FollowUpDto[] {
    return FollowUpMapper.toDtoList(this.followUpRepository.listOpen())
  }

  listOpenByRecord(type: FollowUpRecordType, id: number): FollowUpDto[] {
    return FollowUpMapper.toDtoList(this.followUpRepository.listOpenByRecord(type, id))
  }

  /** Done follow-ups, the last ticked off first */
  listDone(limit: number): FollowUpHistoryDto {
    const rows = this.followUpRepository.listDone(limit)
    return {
      items: FollowUpMapper.toDtoList(rows.slice(0, limit)),
      hasMore: rows.length > limit
    }
  }

  create(input: CreateFollowUpInput): FollowUpDto {
    const created = this.get(this.followUpRepository.create(input))
    scheduleCalendarUpdate()
    return created
  }

  update(input: UpdateFollowUpInput): FollowUpDto {
    this.followUpRepository.update(input)
    scheduleCalendarUpdate()
    return this.get(input.id)
  }

  setDone(id: number, done: boolean): FollowUpDto {
    this.followUpRepository.setDone(id, done)
    scheduleCalendarUpdate()
    return this.get(id)
  }

  /** #121: replies to these sent mails arrived; closes the follow-ups waiting for them */
  closeByReplies(accountId: string, messageIds: readonly string[]): number {
    const closed = this.followUpRepository.closeByReplies(accountId, messageIds)
    if (closed > 0) scheduleCalendarUpdate()
    return closed
  }

  delete(id: number): void {
    this.followUpRepository.delete(id)
    scheduleCalendarUpdate()
  }

  private get(id: number): FollowUpDto {
    const row = this.followUpRepository.getById(id)
    if (!row) throw new Error(`Wiedervorlage ${id} nicht gefunden`)
    return FollowUpMapper.toDto(row)
  }
}
