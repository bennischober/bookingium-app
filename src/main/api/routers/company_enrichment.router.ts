import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { CompanyEnrichmentService } from '../../services/CompanyEnrichmentService'
import {
  CompanyEnrichmentApplyInput,
  CompanyEnrichmentCheckInput
} from '../schemas/company_enrichment.schema'

const t = initTRPC.create()
const service = container.resolve(CompanyEnrichmentService)

/** #236: a known company completed from an invoice it sent */
export const companyEnrichmentRouter = t.router({
  /** What the invoice would add; null when it is from no known company or adds nothing */
  check: t.procedure.input(CompanyEnrichmentCheckInput).query(async ({ input }) => {
    try {
      return await service.check(input.source, input.senderEmail)
    } catch {
      // an unreadable file only means there is nothing to suggest
      return null
    }
  }),

  apply: t.procedure.input(CompanyEnrichmentApplyInput).mutation(({ input }) => {
    try {
      return service.apply(input.companyId, input.party)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Firma konnte nicht ergänzt werden'
      })
    }
  })
})
