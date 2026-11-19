import type { CompanyEnrichmentDto } from '../../../../main/api/schemas/company_enrichment.schema'

// Saving a receipt can find something to add after its dialog closed: the toast's action
// opens the confirmation here, from the root layout
export const COMPANY_ENRICHMENT_EVENT = 'bookingium:company-enrichment'

/** Opens the confirmation for an enrichment from anywhere (a toast action) */
export function openCompanyEnrichment(enrichment: CompanyEnrichmentDto): void {
  window.dispatchEvent(new CustomEvent(COMPANY_ENRICHMENT_EVENT, { detail: enrichment }))
}
