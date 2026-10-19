import { injectable, inject } from 'tsyringe'
import { createHash } from 'crypto'
import { z } from 'zod'
import { ImportRepository } from '../repositories/ImportRepository'
import { SettingsRepository } from '../repositories/SettingsRepository'
import { buildImportPlan } from '../import/buildImportPlan'
import { normalizeKey } from '../import/normalize'
import {
  ImportField,
  ImportTarget,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type ImportWorkbook
} from '../api/schemas/import.schema'

// A mapping the user imported with, remembered for lists with the same columns
const RememberedMapping = z.object({
  target: ImportTarget,
  mapping: z.array(ImportField)
})

const MAPPING_KEY_PREFIX = 'importMapping:'

/** Settings key of a column layout (same headers, same order) */
export function mappingKey(headers: string[]): string {
  const layout = headers.map((header) => normalizeKey(header)).join('|')
  return MAPPING_KEY_PREFIX + createHash('sha1').update(layout).digest('hex')
}

@injectable()
export class ImportService {
  constructor(
    @inject(ImportRepository) private importRepository: ImportRepository,
    @inject(SettingsRepository) private settingsRepository: SettingsRepository
  ) {}

  preview(request: ImportRequest): ImportPreview {
    return buildImportPlan(request, this.importRepository.loadExisting()).preview
  }

  /**
   * Builds the plan again against the current data and writes it; the
   * mapping is remembered for lists with the same columns
   */
  commit(request: ImportRequest): ImportResult {
    const plan = buildImportPlan(request, this.importRepository.loadExisting())
    if (plan.preview.errors.length > 0) throw new Error(plan.preview.errors.join(' '))
    const result = this.importRepository.apply(plan)
    this.settingsRepository.setMany({
      [mappingKey(request.headers)]: JSON.stringify({
        target: request.target,
        mapping: request.mapping
      })
    })
    return result
  }

  /** Puts remembered mappings in place of the detected ones */
  withRememberedMappings(workbook: ImportWorkbook): ImportWorkbook {
    const stored = this.settingsRepository.getAll()
    return {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => {
        const raw = stored[mappingKey(sheet.headers)]
        if (!raw) return sheet
        let parsed: z.infer<typeof RememberedMapping>
        try {
          parsed = RememberedMapping.parse(JSON.parse(raw))
        } catch {
          return sheet
        }
        if (parsed.mapping.length !== sheet.headers.length) return sheet
        return {
          ...sheet,
          suggestedTarget: parsed.target,
          suggestedMappings: { ...sheet.suggestedMappings, [parsed.target]: parsed.mapping },
          mappingRemembered: true
        }
      })
    }
  }
}
