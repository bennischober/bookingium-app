import { injectable, inject } from 'tsyringe'
import { createHash } from 'crypto'
import { z } from 'zod'
import { ExternalBookingRepository } from '../repositories/ExternalBookingRepository'
import { sqlTimestamp } from '../db/timestamps'
import { SettingsRepository } from '../repositories/SettingsRepository'
import { ExternalBookingMapper } from '../api/mappers/external_booking.mapper'
import { buildAgencyImportPlan, detectAgencyMapping } from '../import/agencyBookings'
import { normalizeKey } from '../import/normalize'
import type { PaginationInput } from '../api/schemas/base.schema'
import {
  ExternalBookingField,
  ExternalBookingKind,
  type ExternalBookingAgencyDto,
  type ExternalBookingDto,
  type ExternalBookingImportPreview,
  type ExternalBookingImportRequest,
  type ExternalBookingImportResult,
  type ExternalBookingImportSuggestion
} from '../api/schemas/external_booking.schema'

// #103: Agenturbuchungen - read-only shows of the user's bands booked by another agency. They
// come from the agency's export and change only through its next import. No invoice, contract,
// Abrechnung, mailing list or follow-up service reads them; the calendar, the event list, the
// map (radius clauses) and the event wizard's date check do.

// The columns, agency and default kind used for an export with these headers, remembered so the
// next export of the same agency opens ready to import
const RememberedImport = z.object({
  mapping: z.array(ExternalBookingField),
  agency: z.string(),
  defaultKind: ExternalBookingKind
})

const KEY_PREFIX = 'agencyImport:'

/** Settings key of an export's column layout (same headers, same order) */
export function agencyImportKey(headers: string[]): string {
  const layout = headers.map((header) => normalizeKey(header)).join('|')
  return KEY_PREFIX + createHash('sha1').update(layout).digest('hex')
}

@injectable()
export class ExternalBookingService {
  constructor(
    @inject(ExternalBookingRepository) private repository: ExternalBookingRepository,
    @inject(SettingsRepository) private settingsRepository: SettingsRepository
  ) {}

  getAllPaginated(pagination: PaginationInput & { agency?: string }) {
    const result = this.repository.getAllPaginated(pagination)
    return { ...result, items: ExternalBookingMapper.toDtoList(result.items) }
  }

  listBetween(from: string, to: string): ExternalBookingDto[] {
    return ExternalBookingMapper.toDtoList(this.repository.listBetween(from, to))
  }

  listForBand(bandId: number, from: string, to: string): ExternalBookingDto[] {
    return ExternalBookingMapper.toDtoList(this.repository.listForBand(bandId, from, to))
  }

  agencies(): ExternalBookingAgencyDto[] {
    return this.repository.agencies()
  }

  /** The columns for a picked file: the ones used last time for this layout, else detected */
  suggest(headers: string[]): ExternalBookingImportSuggestion {
    const raw = this.settingsRepository.getAll()[agencyImportKey(headers)]
    if (raw) {
      try {
        const remembered = RememberedImport.parse(JSON.parse(raw))
        if (remembered.mapping.length === headers.length) return { ...remembered, remembered: true }
      } catch {
        // A broken entry falls back to detection
      }
    }
    return {
      mapping: detectAgencyMapping(headers),
      agency: '',
      defaultKind: 'venue',
      remembered: false
    }
  }

  preview(request: ExternalBookingImportRequest): ExternalBookingImportPreview {
    return buildAgencyImportPlan(request, this.repository.loadForImport(request.agency.trim()))
      .preview
  }

  /** Plans again against the current data and writes it; remembers the columns and agency */
  commit(request: ExternalBookingImportRequest): ExternalBookingImportResult {
    const agency = request.agency.trim()
    const plan = buildAgencyImportPlan(request, this.repository.loadForImport(agency))
    if (plan.preview.errors.length > 0) throw new Error(plan.preview.errors.join(' '))
    const written = this.repository.applyImport(plan, {
      agency,
      fileName: request.fileName,
      importedAt: sqlTimestamp()
    })
    this.settingsRepository.setMany({
      [agencyImportKey(request.headers)]: JSON.stringify({
        mapping: request.mapping,
        agency,
        defaultKind: request.defaultKind
      })
    })
    return { ...written, skipped: plan.preview.counts.skipped }
  }

  delete(id: number): void {
    if (!this.repository.delete(id)) throw new Error('Agenturbuchung nicht gefunden')
  }

  /** Removes every booking of the agency; returns how many there were */
  deleteAgency(agency: string): number {
    return this.repository.deleteAgency(agency)
  }
}
