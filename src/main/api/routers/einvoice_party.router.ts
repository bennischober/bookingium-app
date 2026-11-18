import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { EInvoicePartyError, EInvoicePartyService } from '../../services/EInvoicePartyService'
import { attachmentFileName, readSourceFile } from '../sourceFiles'
import { EInvoicePartyInput, EInvoicePartySource } from '../schemas/einvoice_party.schema'

const t = initTRPC.create()
const service = container.resolve(EInvoicePartyService)

export const einvoicePartyRouter = t.router({
  /** Reads the seller of an e-invoice; nothing is written yet */
  read: t.procedure.input(EInvoicePartySource).mutation(async ({ input }) => {
    const { bytes, fileName } = await readSourceFile(
      input,
      ['pdf', 'xml'],
      'Bitte eine PDF- oder XML-Datei wählen.'
    )
    try {
      return await service.read(bytes, fileName || (await attachmentFileName(input)))
    } catch (error) {
      if (error instanceof EInvoicePartyError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
      }
      throw error
    }
  }),

  /** Creates or completes the company and its people as the user confirmed them */
  apply: t.procedure.input(EInvoicePartyInput).mutation(({ input }) => service.apply(input))
})
