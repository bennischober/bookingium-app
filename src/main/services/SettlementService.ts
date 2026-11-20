import { inject, injectable } from 'tsyringe'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { SettlementRepository } from '../repositories/SettlementRepository'
import { AdvancingRepository } from '../repositories/AdvancingRepository'
import { SETTLEMENT_REPORT_NOTE } from '../advancing/advancing'
import { computeSettlement } from '../settlement/settlement'
import { DocumentService } from './DocumentService'
import { readXlsx } from '../import/xlsx'
import { readSettlementSheet } from '../settlement/readSettlementSheet'
import {
  SettlementInputSchema,
  type SaveSettlementInput,
  type SettlementDto,
  type SettlementSheetDto
} from '../api/schemas/settlement.schema'

export const NOT_A_SETTLEMENT =
  'Die Datei ist keine Konzertabrechnung der Agentur (Excel mit „KONZERTABRECHNUNG“, ' +
  'Ticketsystemen, Verkäufen und Deal).'

/** #228: a show's settlement and the management fee from it */
@injectable()
export class SettlementService {
  constructor(
    @inject(SettlementRepository) private repository: SettlementRepository,
    @inject(DocumentService) private documents: DocumentService,
    @inject(AdvancingRepository) private advancing: AdvancingRepository
  ) {}

  get(eventId: number): SettlementDto {
    const event = this.repository.event(eventId)
    if (!event) throw new Error('Event nicht gefunden')
    const row = this.repository.getByEvent(eventId)
    const contract = this.repository.contractOfBand(event.bandId)
    const parsed = row ? SettlementInputSchema.safeParse(JSON.parse(row.data)) : null
    return {
      eventId,
      input: parsed?.success ? parsed.data : null,
      sourceFileName: row?.source_file_name ?? '',
      updatedAt: row?.updated_at ?? null,
      contract: contract
        ? {
            id: contract.id,
            managementCompanyName: contract.managementCompanyName ?? '',
            commissionPercent: contract.commissionPercent,
            agencyPercent: contract.agencyPercent
          }
        : null,
      feeInvoice: this.repository.feeInvoice(row?.fee_invoice_id ?? null)
    }
  }

  /**
   * Stores the settlement. The tickets settled become the sales report of the show day too, so
   * the Tickets tab and the tour overview end on the final count instead of the last presale
   * report; a second save replaces it (one report per show and day).
   */
  save(input: SaveSettlementInput): SettlementDto {
    const event = this.repository.event(input.eventId)
    if (!event) throw new Error('Event nicht gefunden')
    this.repository.save(input.eventId, input.input, input.sourceFileName)
    // the count the settlement shows as „Tickets (n)“
    const { sold } = computeSettlement(input.input)
    if (sold > 0 && event.date) {
      this.advancing.saveReport({
        eventId: input.eventId,
        reportDate: event.date.slice(0, 10),
        sold,
        note: SETTLEMENT_REPORT_NOTE
      })
    }
    return this.get(input.eventId)
  }

  /** Reads a promoter's settlement sheet (.xlsx); nothing is stored yet */
  async readFile(path: string): Promise<SettlementSheetDto> {
    if (extname(path).toLowerCase() !== '.xlsx') throw new Error(NOT_A_SETTLEMENT)
    const { records } = readXlsx(await readFile(path))
    const sheet = readSettlementSheet(records)
    if (!sheet) throw new Error(NOT_A_SETTLEMENT)
    return { fileName: basename(path), ...sheet }
  }

  /** Keeps the promoter's file with the event's documents (Dokumente › Abrechnung) */
  async attachFile(eventId: number, path: string): Promise<void> {
    await this.documents.upload({
      ownerType: 'event',
      ownerId: eventId,
      sourcePath: path,
      documentType: 'settlement'
    })
  }

  createFeeInvoice(eventId: number): number {
    return this.repository.createFeeInvoice(eventId)
  }
}
