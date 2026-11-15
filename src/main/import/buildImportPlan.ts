import type { ImportField, ImportRequest } from '../api/schemas/import.schema'
import { buildBandRows } from './plan/bandRows'
import { createContext } from './plan/context'
import type { ExistingRecords, ImportPlan } from './plan/drafts'
import { buildOrganisationRows } from './plan/organisationRows'
import { buildPersonRows } from './plan/personRows'

// ========================================
// Rows → records to create or complete
// ========================================
// One shared context (plan/context.ts: existing records, drafts, matching) and
// one row loop per kind of list: venue/company lists (plan/organisationRows.ts),
// band lists (plan/bandRows.ts), person lists (plan/personRows.ts). The draft
// types are in plan/drafts.ts.

/** Columns a target cannot do without */
function missingColumns(request: ImportRequest): string[] {
  const has = (field: ImportField) => request.mapping.includes(field)
  switch (request.target) {
    case 'venues':
      return has('venueName') || has('companyName')
        ? []
        : ['Ordnen Sie eine Spalte „Club / Festival“ oder „Veranstalter (Firma)“ zu.']
    case 'companies':
      return has('companyName') ? [] : ['Ordnen Sie die Spalte „Firma“ zu.']
    case 'bands':
      return [
        ...(has('bandName') ? [] : ['Ordnen Sie die Spalte „Band“ zu.']),
        ...(has('companyName')
          ? []
          : ['Ordnen Sie die Spalte „Firma der Band“ zu – jede Band gehört zu einer Firma.'])
      ]
    case 'persons':
      return has('personName') || has('firstName') || has('lastName')
        ? []
        : ['Ordnen Sie eine Spalte „Name“ oder „Vorname“/„Nachname“ zu.']
  }
}

export function buildImportPlan(request: ImportRequest, existing: ExistingRecords): ImportPlan {
  const ctx = createContext(request, existing)
  const errors = missingColumns(request)
  if (errors.length > 0) return ctx.finish([], errors)

  const rows =
    request.target === 'bands'
      ? buildBandRows(ctx)
      : request.target === 'persons'
        ? buildPersonRows(ctx)
        : buildOrganisationRows(ctx)
  return ctx.finish(rows, errors)
}
