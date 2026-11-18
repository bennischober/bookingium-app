import { injectable, inject } from 'tsyringe'
import { scheduleCalendarUpdate } from './CalendarFeedService'
import { removeOwnerFolder } from '../utils/documentStorage'
import { DealMemoRepository } from '../repositories/DealMemoRepository'
import type {
  CreateDealMemoInput,
  SetDealMemoStatusesInput,
  UpdateDealMemoInput
} from '../api/schemas/deal_memo.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class DealMemoService {
  constructor(@inject(DealMemoRepository) private dealMemoRepository: DealMemoRepository) {}

  async getAllDealMemosPaginated(pagination: PaginationInput & { tour?: string }) {
    return await this.dealMemoRepository.getAllPaginated(pagination)
  }

  async listDealMemosByBand(bandId: number) {
    return await this.dealMemoRepository.listByBand(bandId)
  }

  async listDealMemosByVenue(venueId: number) {
    return await this.dealMemoRepository.listByVenue(venueId)
  }

  async listDealMemosByCompany(companyId: number) {
    return await this.dealMemoRepository.listByCompany(companyId)
  }

  async listDealMemosByPerson(personId: number) {
    return await this.dealMemoRepository.listByPerson(personId)
  }

  async getDealMemoById(id: number) {
    return await this.dealMemoRepository.getById(id)
  }

  async createDealMemo(input: CreateDealMemoInput) {
    const result = await this.dealMemoRepository.create(input)
    scheduleCalendarUpdate()
    return result
  }

  async updateDealMemo(input: UpdateDealMemoInput) {
    const result = await this.dealMemoRepository.update(input)
    scheduleCalendarUpdate()
    return result
  }

  async deleteDealMemo(id: number) {
    await this.dealMemoRepository.delete(id)
    // Rows go with the owner (trigger); the files are removed here
    await removeOwnerFolder('event', id).catch((error) => console.error(error))
    scheduleCalendarUpdate()
  }

  /**
   * D3: archiving keeps everything - itinerary, follow-ups, documents, mails and the link
   * from the event's invoices. Only the working views stop showing it.
   */
  async archiveDealMemo(id: number) {
    const result = await this.dealMemoRepository.archive(id)
    // An archived gig is not a booking on the calendar any more
    scheduleCalendarUpdate()
    return result
  }

  async restoreDealMemo(id: number) {
    const result = await this.dealMemoRepository.restore(id)
    scheduleCalendarUpdate()
    return result
  }

  /** #200: statuses of several events; returns the statuses they had (for "Rückgängig") */
  setDealMemoStatuses(input: SetDealMemoStatusesInput) {
    const before = this.dealMemoRepository.setStatuses(input.changes)
    if (before.length > 0) scheduleCalendarUpdate()
    return { changes: before }
  }

  /** #200: archives several events (D3: nothing is lost); returns the ones archived now */
  archiveDealMemos(ids: number[]) {
    const archived = this.dealMemoRepository.archiveMany(ids)
    if (archived.length > 0) scheduleCalendarUpdate()
    return { ids: archived }
  }

  /** #200: restores several archived events; returns the ones restored now */
  restoreDealMemos(ids: number[]) {
    const restored = this.dealMemoRepository.restoreMany(ids)
    if (restored.length > 0) scheduleCalendarUpdate()
    return { ids: restored }
  }

  async listArchivedDealMemos() {
    return await this.dealMemoRepository.listArchived()
  }

  /** D3: whether an invoice still points at this event, which blocks a hard delete */
  async hasLinkedInvoice(id: number) {
    return await this.dealMemoRepository.hasLinkedInvoice(id)
  }
}
