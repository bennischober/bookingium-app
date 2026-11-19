import { z } from 'zod'
import { EInvoicePartyInput, EInvoicePartySource } from './einvoice_party.schema'

// #236: a known company completed from an invoice it sent - only fields still empty

export const CompanyEnrichmentCheckInput = z.object({
  source: EInvoicePartySource,
  /** The mail's sender, a hint which company the invoice is from */
  senderEmail: z.string().max(320).default('')
})
export type CompanyEnrichmentCheckInput = z.infer<typeof CompanyEnrichmentCheckInput>

export const CompanyEnrichmentFill = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string()
})
export type CompanyEnrichmentFill = z.infer<typeof CompanyEnrichmentFill>

export const CompanyEnrichmentDto = z.object({
  companyId: z.number(),
  companyName: z.string(),
  /** e-invoice data (reliable) or read from the PDF's text (to be checked) */
  origin: z.enum(['einvoice', 'pdf']),
  /** How the company was recognised */
  matchedBy: z.enum(['vatId', 'taxNumber', 'iban', 'email', 'name']),
  fills: z.array(CompanyEnrichmentFill),
  /** What apply writes; only the empty fields of the company take it */
  party: EInvoicePartyInput
})
export type CompanyEnrichmentDto = z.infer<typeof CompanyEnrichmentDto>

export const CompanyEnrichmentApplyInput = z.object({
  companyId: z.number().int().positive(),
  party: EInvoicePartyInput
})
export type CompanyEnrichmentApplyInput = z.infer<typeof CompanyEnrichmentApplyInput>
