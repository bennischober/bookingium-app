import { injectable, inject } from 'tsyringe'
import { createHash } from 'crypto'
import { z } from 'zod'
import { TourImportRepository } from '../repositories/TourImportRepository'
import { SettingsRepository } from '../repositories/SettingsRepository'
import { buildTourImportPlan, detectTourMapping, tourTitleHints } from '../import/tourDates'
import { hasGeneratedHeaders } from '../import/generatedHeaders'
import { cleanText, normalizeKey } from '../import/normalize'
import { parseShowDate } from '../import/agencyBookings'
import { scheduleCalendarUpdate } from './CalendarFeedService'
import { DealMemoStatus } from '../api/schemas/deal_memo.schema'
import { VenueKind } from '../api/schemas/venue.schema'
import {
  TourImportField,
  type TourImportPreview,
  type SaveTourInput,
  type SaveTourResult,
  type TourCandidateDto,
  type TourImportRequest,
  type TourImportResult,
  type TourImportSuggestion
} from '../api/schemas/tour_import.schema'

// Tour import (Tourdaten): own events from a tour sheet (CSV or .xlsx). The columns, tour and
// defaults used for a sheet with these headers are remembered, so the next version of the
// sheet opens ready to import.

const RememberedImport = z.object({
  mapping: z.array(TourImportField),
  band: z.string().default(''),
  tour: z.string(),
  defaultKind: VenueKind,
  defaultStatus: DealMemoStatus
})

const KEY_PREFIX = 'tourImport:'

/** Settings key of a sheet's column layout (same headers, same order) */
export function tourImportKey(headers: string[]): string {
  const layout = headers.map((header) => normalizeKey(header)).join('|')
  return KEY_PREFIX + createHash('sha1').update(layout).digest('hex')
}

/**
 * A remembered mapping still fits the sheet when its date column holds dates; one saved before
 * the weekday fix ("Tag" as the date) does not and is detected afresh
 */
function datesFit(mapping: TourImportField[], rows: Array<{ cells: string[] }>): boolean {
  const column = mapping.indexOf('date')
  if (column < 0) return false
  const values = rows.map((row) => cleanText(row.cells[column] ?? '')).filter(Boolean)
  if (values.length === 0) return true
  return values.filter((value) => parseShowDate(value) !== '').length / values.length >= 0.5
}

@injectable()
export class TourImportService {
  constructor(
    @inject(TourImportRepository) private repository: TourImportRepository,
    @inject(SettingsRepository) private settingsRepository: SettingsRepository
  ) {}

  /**
   * The columns, band, tour and defaults for a picked sheet: remembered for its column layout,
   * else detected. A title row above the sheet names the band and the tour. A sheet without a
   * header row is never remembered: "Spalte A, Spalte B, …" would match any other such sheet.
   */
  suggest(
    headers: string[],
    title = '',
    rows: Array<{ cells: string[] }> = []
  ): TourImportSuggestion {
    const hints = tourTitleHints(title, this.repository.loadForImport().bands)
    const raw = hasGeneratedHeaders(headers)
      ? undefined
      : this.settingsRepository.getAll()[tourImportKey(headers)]
    if (raw) {
      try {
        const remembered = RememberedImport.parse(JSON.parse(raw))
        if (remembered.mapping.length === headers.length && datesFit(remembered.mapping, rows)) {
          return {
            ...remembered,
            band: hints.band || remembered.band,
            tour: hints.tour || remembered.tour,
            remembered: true
          }
        }
      } catch {
        // A broken entry falls back to detection
      }
    }
    return {
      mapping: detectTourMapping(headers, rows),
      band: hints.band,
      tour: hints.tour,
      defaultKind: 'venue',
      defaultStatus: 'confirmed',
      remembered: false
    }
  }

  preview(request: TourImportRequest): TourImportPreview {
    return buildTourImportPlan(request, this.repository.loadForImport()).preview
  }

  /** Plans again against the current data and writes it; remembers the columns and defaults */
  commit(request: TourImportRequest): TourImportResult {
    const plan = buildTourImportPlan(request, this.repository.loadForImport())
    if (plan.preview.errors.length > 0) throw new Error(plan.preview.errors.join(' '))
    const written = this.repository.applyImport(plan)
    if (!hasGeneratedHeaders(request.headers)) {
      this.settingsRepository.setMany({
        [tourImportKey(request.headers)]: JSON.stringify({
          mapping: request.mapping,
          band: request.band,
          tour: request.tour,
          defaultKind: request.defaultKind,
          defaultStatus: request.defaultStatus
        })
      })
    }
    if (written.created + written.updated > 0) scheduleCalendarUpdate()
    return {
      ...written,
      unchanged: plan.preview.counts.unchanged,
      skipped: plan.preview.counts.skipped
    }
  }

  /** The tours the events name, for the filters (map, event list) */
  tours(): string[] {
    return this.repository.tours()
  }

  /** Active events the tour dialog offers */
  tourCandidates(): TourCandidateDto[] {
    return this.repository.tourCandidates()
  }

  /** Renames a tour and sets its shows */
  saveTour(input: SaveTourInput): SaveTourResult {
    return this.repository.saveTour(input)
  }
}
