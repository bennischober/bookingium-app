import { injectable, inject } from 'tsyringe'
import { FollowUpRepository } from '../repositories/FollowUpRepository'
import { FollowUpMapper } from '../api/mappers/followUp.mapper'
import type {
  CreateFollowUpInput,
  FollowUpDto,
  FollowUpRecordType,
  UpdateFollowUpInput
} from '../api/schemas/followUp.schema'

// Follow-ups (Wiedervorlagen): due dates with a note, on a record or general.
// Done ones stay in the table (done_at) so "Rückgängig" can bring them back.
@injectable()
export class FollowUpService {
  constructor(@inject(FollowUpRepository) private followUpRepository: FollowUpRepository) {}

  listOpen(): FollowUpDto[] {
    return FollowUpMapper.toDtoList(this.followUpRepository.listOpen())
  }

  listOpenByRecord(type: FollowUpRecordType, id: number): FollowUpDto[] {
    return FollowUpMapper.toDtoList(this.followUpRepository.listOpenByRecord(type, id))
  }

  create(input: CreateFollowUpInput): FollowUpDto {
    return this.get(this.followUpRepository.create(input))
  }

  update(input: UpdateFollowUpInput): FollowUpDto {
    this.followUpRepository.update(input)
    return this.get(input.id)
  }

  setDone(id: number, done: boolean): FollowUpDto {
    this.followUpRepository.setDone(id, done)
    return this.get(id)
  }

  delete(id: number): void {
    this.followUpRepository.delete(id)
  }

  private get(id: number): FollowUpDto {
    const row = this.followUpRepository.getById(id)
    if (!row) throw new Error(`Wiedervorlage ${id} nicht gefunden`)
    return FollowUpMapper.toDto(row)
  }
}
