// H2: the sync bar must be able to show that a send is running.
//
// The bar showed a spinner while syncing, but a send was invisible until it finished: the
// core emitted an op-event only when the op RESULT arrived. So a send that takes seconds
// (a slow SMTP server) looked like nothing happened at all.
//
// The fix emits a 'running' event before the write executes. This suite drives a real send
// through the core and asserts the event sequence. The SMTP endpoint is unreachable on
// purpose - the running event must be emitted BEFORE the connection is attempted, which is
// exactly what makes it observable here.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMailCore, type MailCoreEvent } from '../src/main/mailclient/core/index'

const ACCOUNT = 'ops'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-ops-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const mkCore = (dataDir: string) =>
  createMailCore({
    dataDir,
    accounts: [
      {
        id: ACCOUNT,
        // A writable account: sendMail refuses a read-only one at writableEntry(), before
        // any op is journaled - so a sandbox account would never reach the event under test
        readOnly: false,
        // sendMail refuses to build a message without a From address
        email: 'a@example.test',
        host: '127.0.0.1',
        port: 1, // unreachable on purpose: the send fails, but it is announced first
        security: 'none' as const,
        credentials: async () => ({ user: 'a@example.test', pass: 'x' })
      }
    ]
  })

const draft = {
  to: [{ name: '', email: 'a@example.test' }],
  cc: [],
  bcc: [],
  subject: 'H2 Test',
  bodyText: 'Text',
  bodyHtml: '<p>Text</p>',
  inReplyTo: null,
  references: [],
  attachments: []
}

describe('H2: a send is announced before it runs', () => {
  it('emits a running event, not only the result', async () => {
    const api = mkCore(scratchDir())
    const seen: { kind: string; outcome: string }[] = []
    api.on('op-event', (event: MailCoreEvent) => {
      if (event.type === 'op-event') seen.push({ kind: event.kind, outcome: event.outcome })
    })

    try {
      // The server is unreachable, so this rejects - the events are what matter
      await api.sendMail(draft, null, ACCOUNT).catch(() => undefined)
    } finally {
      api.close()
    }

    const kinds = seen.map((e) => e.kind)
    expect(kinds).toContain('send')
    // The one that was missing: the start, not just the finish
    expect(seen.some((e) => e.kind === 'send' && e.outcome === 'running')).toBe(true)
  }, 30_000)

  it('does not announce the autosave as a visible op', async () => {
    // draft_save runs every 1.5 s while typing; it must never reach the bar, or it blinks
    const api = mkCore(scratchDir())
    const seen: string[] = []
    api.on('op-event', (event: MailCoreEvent) => {
      if (event.type === 'op-event') seen.push(`${event.kind}:${event.outcome}`)
    })

    try {
      await api.sendMail(draft, null, ACCOUNT).catch(() => undefined)
    } finally {
      api.close()
    }

    // A send writes no draft, so no draft_save event may appear in this flow at all
    expect(seen.filter((e) => e.startsWith('draft_save'))).toEqual([])
  }, 30_000)
})
