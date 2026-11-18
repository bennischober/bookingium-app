import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import { EInvoicePartyError, EInvoicePartyService } from '../../services/EInvoicePartyService'
import { mailClient } from '../../mailclient/MailClientService'
import { EInvoicePartyInput, EInvoicePartySource } from '../schemas/einvoice_party.schema'

const t = initTRPC.create()
const service = container.resolve(EInvoicePartyService)

// E-invoices are small; anything far larger is not one
const MAX_BYTES = 30 * 1024 * 1024
const FILE_TYPES = ['.pdf', '.xml']

const badRequest = (message: string): TRPCError => new TRPCError({ code: 'BAD_REQUEST', message })

/** The file's bytes and name; main reads them, the renderer only names the source */
async function sourceBytes(
  source: EInvoicePartySource
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (source.kind === 'file') {
    if (!FILE_TYPES.includes(extname(source.path).toLowerCase())) {
      throw badRequest('Bitte eine PDF- oder XML-Datei wählen.')
    }
    const info = await stat(source.path).catch(() => null)
    if (!info?.isFile()) throw badRequest('Die Datei wurde nicht gefunden.')
    if (info.size > MAX_BYTES) throw badRequest('Die Datei ist zu groß für eine E-Rechnung.')
    return { bytes: new Uint8Array(await readFile(source.path)), fileName: basename(source.path) }
  }
  let bytes: Uint8Array
  try {
    bytes = (await mailClient.call('getAttachment', [
      source.messageId,
      source.partId,
      source.accountId
    ])) as Uint8Array
  } catch {
    throw badRequest('Anhang konnte nicht geladen werden')
  }
  if (bytes.length > MAX_BYTES) throw badRequest('Der Anhang ist zu groß für eine E-Rechnung.')
  return { bytes, fileName: '' }
}

export const einvoicePartyRouter = t.router({
  /** Reads the seller of an e-invoice; nothing is written yet */
  read: t.procedure.input(EInvoicePartySource).mutation(async ({ input }) => {
    const { bytes, fileName } = await sourceBytes(input)
    try {
      return await service.read(bytes, fileName)
    } catch (error) {
      if (error instanceof EInvoicePartyError) throw badRequest(error.message)
      throw error
    }
  }),

  /** Creates or completes the company and its people as the user confirmed them */
  apply: t.procedure.input(EInvoicePartyInput).mutation(({ input }) => service.apply(input))
})
