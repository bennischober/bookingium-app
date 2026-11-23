import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { container } from 'tsyringe'
import { DatevService } from '../../services/DatevService'
import { DatevMapper } from '../mappers/datev.mapper'
import { InvoiceMapper } from '../mappers/invoice.mapper'
import { SetDatevUploadEmailInput } from '../schemas/datev.schema'
import { adminOnly } from '../access'

const t = initTRPC.create()
const datevService = container.resolve(DatevService)
// #262: DATEV is company-internal, closed in staff access
const adminProcedure = t.procedure.use(t.middleware(adminOnly))

/** DATEV hand-over by DATEV Upload Mail (the send itself is the invoice:datev IPC channel) */
export const datevRouter = t.router({
  /** Issued invoices of DATEV companies not handed over yet, oldest first (Dashboard) */
  listNotHandedOver: adminProcedure.query(() =>
    datevService.listNotHandedOver().map((row) => DatevMapper.toPendingInvoiceDto(row))
  ),

  /** An invoice's hand-overs to DATEV, newest first */
  listForInvoice: adminProcedure
    .input(z.number())
    .query(({ input }) =>
      datevService.listForInvoice(input).map((row) => DatevMapper.toTransferDto(row))
    ),

  /** The DATEV Upload Mail address of an issuing company (Einstellungen › Rechnungen) */
  setUploadEmail: adminProcedure.input(SetDatevUploadEmailInput).mutation(async ({ input }) => {
    const settings = await datevService.setUploadEmail(input)
    return InvoiceMapper.toSettingsDto(settings)
  })
})
