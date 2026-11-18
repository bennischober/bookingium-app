import { injectable, inject } from 'tsyringe'
import { createHash } from 'crypto'
import { z } from 'zod'
import { TourImportRepository } from '../repositories/TourImportRepository'
import { SettingsRepository } from '../repositories/SettingsRepository'
import { buildTourImportPlan, detectTourMapping } from '../import/tourDates'
import { normalizeKey } from '../import/normalize'
import { scheduleCalendarUpdate } from './CalendarFeedService'
import { DealMemoStatus } from '../api/schemas/deal_memo.schema'
import { VenueKind } from '../api/schemas/venue.schema'
import {
  TourImportField,
  type TourImportPreview,
  type TourImportRequest,
  type TourImportResult,
  type TourImportSuggestion
} from '../api/schemas/tour_import.schema'

// Tour import (Tourdaten): own events from a tour sheet (CSV or .xlsx). The columns, tour and
// defaults used for a sheet with these headers are remembered, so the next version of the
// sheet opens ready to import.

const RememberedImport = z.object({
  mapping: z.array(TourImportField),
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

@injectable()
export class TourImportService {
  constructor(
    @inject(TourImportRepository) private repository: TourImportRepository,
    @inject(SettingsRepository) private settingsRepository: SettingsRepository
  ) {}

  suggest(headers: string[]): TourImportSuggestion {
    const raw = this.settingsRepository.getAll()[tourImportKey(headers)]
    if (raw) {
      try {
        const remembered = RememberedImport.parse(JSON.parse(raw))
        if (remembered.mapping.length === headers.length) return { ...remembered, remembered: true }
      } catch {
        // A broken entry falls back to detection
      }
    }
    return {
      mapping: detectTourMapping(headers),
      tour: '',
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
    this.settingsRepository.setMany({
      [tourImportKey(request.headers)]: JSON.stringify({
        mapping: request.mapping,
        tour: request.tour,
        defaultKind: request.defaultKind,
        defaultStatus: request.defaultStatus
      })
    })
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
}
