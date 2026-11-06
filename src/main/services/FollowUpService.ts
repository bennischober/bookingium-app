import { injectable, inject } from 'tsyringe'
import { FollowUpRepository } from '../repositories/FollowUpRepository'
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
@injectable()
export class FollowUpService {
  constructor(@inject(FollowUpRepository) private followUpRepository: FollowUpRepository) {}

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
