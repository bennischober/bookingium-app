import { inject, injectable } from 'tsyringe'
import { MergeRepository } from '../repositories/MergeRepository'
import { scheduleCalendarUpdate, scheduleFollowUpCalendarUpdate } from './CalendarFeedService'
import type {
  DuplicateGroupDto,
  MergeCandidateDto,
  MergeInput,
  MergeKind,
  MergePairInput,
  MergePreviewDto
} from '../api/schemas/merge.schema'

/** #249: "Zusammenführen" of two companies, persons or clubs/festivals */
@injectable()
export class MergeService {
  constructor(@inject(MergeRepository) private repository: MergeRepository) {}

  preview(input: MergePairInput): MergePreviewDto {
    return this.repository.preview(input)
  }

  merge(input: MergeInput): number {
    const id = this.repository.merge(input)
    // events, follow-ups and appointments may name the merged record
    scheduleCalendarUpdate()
    scheduleFollowUpCalendarUpdate()
    return id
  }

  duplicateGroups(kind: MergeKind): DuplicateGroupDto[] {
    return this.repository.duplicateGroups(kind)
  }

  candidates(kind: MergeKind, id: number): MergeCandidateDto[] {
    return this.repository.candidates(kind, id)
  }
}
