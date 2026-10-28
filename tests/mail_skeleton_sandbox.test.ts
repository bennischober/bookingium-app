// S1 step 1: the skeleton of a message reads like the message itself, against the real sandbox
// Dovecot. Every corpus mail is appended, then fetched twice: as BODYSTRUCTURE plus the sections
// skeleton.ts asks for, and whole. mailparser (through parse.ts) must give the same headers, text,
// HTML (including cid images inlined as data: URLs) and attachment list from both, and the sizes
// estimated from BODYSTRUCTURE must be close to the real ones.
//
// Failures name the corpus mail and the differing field, never its content. Skips (with a visible
// reason) when the sandbox is down; the mails it appends are removed again, the folder stays.
import { sandboxSkipReason } from './helpers/sandboxGate'
import { SANDBOX_HOST, SANDBOX_IMAP_PORT, SANDBOX_PASS, SANDBOX_USER } from './helpers/writeAccount'
import { mimeCorpus } from './helpers/mimeCorpus'
import net from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ImapFlow, type MessageStructureObject } from 'imapflow'
import { parseMessage, type ParsedMessage } from '../src/main/mailclient/core/parse'
import {
  buildSkeleton,
  estimatedPartSizes,
  skeletonSections
} from '../src/main/mailclient/core/skeleton'

const FOLDER = 'S1Skeleton'
const SUBJECT_PREFIX = 'bookingum-s1-skeleton-'

/** True when something listens on the port (the sandbox is up) */
function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: SANDBOX_HOST, port, timeout: 1000 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

const sandboxUp = await reachable(SANDBOX_IMAP_PORT)
const skipReason = sandboxSkipReason(sandboxUp, 'mail skeleton', SANDBOX_IMAP_PORT)
if (skipReason) console.warn(skipReason)

const corpus = mimeCorpus(SUBJECT_PREFIX, SANDBOX_USER)

/** What the app reads from a parsed message, as comparable plain values */
function view(m: ParsedMessage) {
  return {
    subject: m.subject,
    messageId: m.messageId,
    from: m.from?.text,
    to: Array.isArray(m.to) ? m.to.map((a) => a.text) : m.to?.text,
    date: m.date?.toISOString(),
    headerLines: m.headerLines,
    text: m.text,
    html: m.html,
    attachments: m.attachments.map((a) => ({
      partId: a.partId ?? null,
      filename: a.filename,
      contentType: a.contentType,
      contentDisposition: a.contentDisposition,
      contentId: a.contentId,
      cid: a.cid,
      related: a.related
    }))
  }
}

/** Paths of the fields that differ, so a failure says where without showing the content */
function differences(a: unknown, b: unknown, at = ''): string[] {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].flatMap((k) =>
      differences(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${at}.${k}`
      )
    )
  }
  return a === b ? [] : [at || '(root)']
}

describe.skipIf(!sandboxUp)('S1 skeleton reads like the full message (sandbox)', () => {
  let client: ImapFlow
  const uids = new Map<string, number>()

  beforeAll(async () => {
    client = new ImapFlow({
      host: SANDBOX_HOST,
      port: SANDBOX_IMAP_PORT,
      secure: false,
      auth: { user: SANDBOX_USER, pass: SANDBOX_PASS },
      logger: false
    })
    await client.connect()
    if (!(await client.list()).some((b) => b.path === FOLDER)) await client.mailboxCreate(FOLDER)
    for (const mail of corpus) {
      const result = await client.append(FOLDER, mail.mime, [])
      if (!result || typeof result !== 'object' || !result.uid)
        throw new Error('append returned no uid')
      uids.set(mail.name, Number(result.uid))
    }
    await client.mailboxOpen(FOLDER)
  })

  afterAll(async () => {
    if (!client) return
    if (uids.size) await client.messageDelete([...uids.values()].join(','), { uid: true })
    await client.logout().catch(() => client.close())
  })

  it.each(corpus.map((m) => [m.name, m] as const))('%s', async (_name, mail) => {
    const uid = uids.get(mail.name)!
    const meta = await client.fetchOne(
      String(uid),
      { bodyStructure: true, size: true },
      { uid: true }
    )
    if (!meta || !meta.bodyStructure) throw new Error('no BODYSTRUCTURE')
    const structure: MessageStructureObject = meta.bodyStructure
    const sections = skeletonSections(structure)
    expect(sections, 'the corpus has no structure the skeleton gives up on').not.toBeNull()

    const parts = await client.fetchOne(
      String(uid),
      { headers: true, ...(sections!.length ? { bodyParts: sections! } : {}) },
      { uid: true }
    )
    if (!parts || !parts.headers) throw new Error('no header section')
    const skeleton = buildSkeleton(structure, parts.headers, parts.bodyParts ?? new Map())
    expect(skeleton, 'every section the skeleton asked for came back').not.toBeNull()

    const whole = await client.fetchOne(String(uid), { source: true }, { uid: true })
    if (!whole || !whole.source) throw new Error('no source')
    const full = await parseMessage(whole.source)
    const fromSkeleton = await parseMessage(skeleton!)

    expect(differences(view(fromSkeleton), view(full))).toEqual([])
    if (/cid/.test(mail.name))
      expect(String(full.html).includes('data:image/'), 'the cid image is inlined').toBe(true)

    const sizes = estimatedPartSizes(structure)
    const off = full.attachments.flatMap((a) => {
      const estimate = sizes.get(a.partId ?? '')
      if (estimate === undefined) return [`${a.partId ?? "''"}: no estimate`]
      return Math.abs(estimate - a.size) <= Math.max(a.size * 0.03, 64)
        ? []
        : [`${a.partId ?? "''"}: off`]
    })
    expect(off).toEqual([])

    if (mail.big) expect(skeleton!.length).toBeLessThan(whole.source.length / 10)
  })
})
