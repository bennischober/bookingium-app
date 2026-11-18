import { TRPCError } from '@trpc/server'
import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import { mailClient } from '../mailclient/MailClientService'
import { storedAttachmentName } from '../mailclient/attachments'

// A file the renderer names but main reads (#222, #225): a dropped or picked path, or a mail
// attachment straight from the mail worker. The renderer never hands over bytes.

export type SourceFile =
  | { kind: 'file'; path: string }
  | { kind: 'attachment'; accountId: string; messageId: number; partId: string }

// Invoices and receipts are small; anything far larger is not one
const MAX_BYTES = 30 * 1024 * 1024

const badRequest = (message: string): TRPCError => new TRPCError({ code: 'BAD_REQUEST', message })

/** The file's bytes and name ('' for an attachment); only the given extensions for paths */
export async function readSourceFile(
  source: SourceFile,
  extensions: readonly string[],
  wrongType: string
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (source.kind === 'file') {
    if (!extensions.includes(extname(source.path).slice(1).toLowerCase())) {
      throw badRequest(wrongType)
    }
    const info = await stat(source.path).catch(() => null)
    if (!info?.isFile()) throw badRequest('Die Datei wurde nicht gefunden.')
    if (info.size > MAX_BYTES) throw badRequest('Die Datei ist zu groß (höchstens 30 MB).')
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
  if (bytes.length > MAX_BYTES) throw badRequest('Der Anhang ist zu groß (höchstens 30 MB).')
  return { bytes, fileName: '' }
}

/** I11: the attachment's name as stored with the mail, sanitized; '' if unknown */
export async function attachmentFileName(source: SourceFile): Promise<string> {
  if (source.kind !== 'attachment') return ''
  try {
    const detail = (await mailClient.call('getMessage', [source.messageId, source.accountId])) as {
      attachments: { partId: string; filename: string | null }[]
    }
    return storedAttachmentName(detail.attachments, source.partId)
  } catch {
    return ''
  }
}
