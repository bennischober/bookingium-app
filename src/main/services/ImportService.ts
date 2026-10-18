import { injectable, inject } from 'tsyringe'
import { ImportRepository } from '../repositories/ImportRepository'
import { buildImportPlan } from '../import/buildImportPlan'
import type { ImportPreview, ImportRequest, ImportResult } from '../api/schemas/import.schema'

@injectable()
export class ImportService {
  constructor(@inject(ImportRepository) private importRepository: ImportRepository) {}

  preview(request: ImportRequest): ImportPreview {
    return buildImportPlan(request, this.importRepository.loadExisting()).preview
  }

  /** Builds the plan again against the current data and writes it */
  commit(request: ImportRequest): ImportResult {
    const plan = buildImportPlan(request, this.importRepository.loadExisting())
    if (plan.preview.errors.length > 0) throw new Error(plan.preview.errors.join(' '))
    return this.importRepository.apply(plan)
  }
}
