// MIME source of a mail to send or a draft to store, built by nodemailer's MailComposer: it
// encodes every header and address (no user text ever reaches a header line raw), puts text
// and HTML side by side as alternatives, and encodes the attachments.
import crypto from 'crypto'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import type { DraftInput } from './types.js'

export type Address = { name: string; email: string }

export interface ComposeOptions {
  from: Address
  date: Date
  /** A draft keeps its Bcc header (it is read back when the draft is opened again);
   *  a mail to send never carries one, the recipients get it from the envelope only */
  draft: boolean
  /** Attachments taken over from another message (forward), after the draft's own */
  extraAttachments?: { filename: string; contentType: string; content: Buffer }[]
}

import { isValidEmail } from './address.js'

export interface ComposedMime {
  raw: Buffer
  /** Without the angle brackets */
  messageId: string
}

// One shared guard with the renderer: shape plus header-injection safety (core/address.ts)

export class ComposeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComposeError'
  }
}

function addresses(list: Address[], field: string): { name: string; address: string }[] {
  return list.map((a) => {
    const email = a.email.trim()
    if (!isValidEmail(email)) throw new ComposeError(`${field}: "${email}" ist keine gültige Adresse`)
    return { name: a.name.replace(/[\r\n]+/g, ' ').trim(), address: email }
  })
}

const SEND_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function composeMime(mail: DraftInput, opts: ComposeOptions): Promise<ComposedMime> {
  const [from] = addresses([opts.from], 'From')
  const domain = from.address.split('@')[1]
  // I2: a send takes the editor's key, so the same mail sent twice has one Message-ID and the
  // Sent probe recognises it. A draft always gets a fresh one: a draft save finds its own
  // earlier copy by it, and each save is a new copy.
  const key = !opts.draft && mail.sendKey && SEND_KEY.test(mail.sendKey) ? mail.sendKey : crypto.randomUUID()
  const messageId = `${key}@${domain}`
  const composer = new MailComposer({
    from,
    to: addresses(mail.to, 'An'),
    cc: addresses(mail.cc, 'Cc'),
    bcc: addresses(mail.bcc, 'Bcc'),
    subject: mail.subject.replace(/[\r\n]+/g, ' '),
    date: opts.date,
    messageId: `<${messageId}>`,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references.length ? mail.references : undefined,
    text: mail.bodyText,
    html: mail.bodyHtml ?? undefined,
    attachments: [
      ...mail.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.from(a.base64, 'base64')
      })),
      ...(opts.extraAttachments ?? [])
    ],
    headers: opts.draft ? { 'X-Mail-Client-Draft': 'yes' } : undefined
  })
  const node = composer.compile()
  node.keepBcc = opts.draft
  const raw = await node.build()
  return { raw, messageId }
}
