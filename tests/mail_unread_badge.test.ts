// The unread count on the "E-Mail" menu entry: every account's INBOX, as its folder shows it,
// refreshed by the mail client's events only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMailCore } from '../src/main/mailclient/core/index'
import type { Store } from '../src/main/mailclient/core/store'
import { OP_REFRESH_MS, SYNC_REFRESH_MS } from '../src/renderer/src/components/mail/mailRefresh'
import {
  UNREAD_BADGE_KEY,
  inboxUnreadTotal,
  unreadBadgeLabel,
  unreadBadgePlan
} from '../src/renderer/src/components/mail/unreadBadge'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

describe('the badge number', () => {
  it('adds up the accounts', () => {
    expect(inboxUnreadTotal({ a: 2, b: 0, c: 5 })).toBe(7)
  })

  it('is 0 before the counts arrive and ignores nonsense', () => {
    expect(inboxUnreadTotal(undefined)).toBe(0)
    expect(inboxUnreadTotal({})).toBe(0)
    expect(inboxUnreadTotal({ a: Number.NaN, b: -1, c: 3 })).toBe(3)
  })

  it('caps the label so the menu keeps its width', () => {
    expect(unreadBadgeLabel(1)).toBe('1')
    expect(unreadBadgeLabel(99)).toBe('99')
    expect(unreadBadgeLabel(100)).toBe('99+')
  })
})

describe('when the badge refreshes', () => {
  it('soon after a write op, such as marking read', () => {
    expect(
      unreadBadgePlan({ type: 'op-event', event: undefined } as Parameters<
        typeof unreadBadgePlan
      >[0])
    ).toEqual({ delayMs: OP_REFRESH_MS, keys: [UNREAD_BADGE_KEY] })
  })

  it('after a sync that stored or changed mail', () => {
    expect(
      unreadBadgePlan({
        type: 'sync-event',
        event: { type: 'folder-done', path: 'INBOX', newCount: 2 }
      })
    ).toEqual({ delayMs: SYNC_REFRESH_MS, keys: [UNREAD_BADGE_KEY] })
  })

  it('not after a sync that changed nothing, or progress events', () => {
    expect(
      unreadBadgePlan({ type: 'sync-event', event: { type: 'folder-done', path: 'INBOX' } })
    ).toBeNull()
    expect(unreadBadgePlan({ type: 'sync-event', event: { type: 'pass-start' } })).toBeNull()
    expect(unreadBadgePlan({ type: 'image-progress' })).toBeNull()
  })

  it('under its own key, apart from the per-account mail queries', () => {
    expect(UNREAD_BADGE_KEY[0]).not.toBe('mail')
  })
})

describe('the core counts unread mail in each INBOX', () => {
  let uid = 0
  function addMessage(store: Store, accountId: string, folderId: string, seen: boolean): void {
    uid += 1
    store.insertMessage({
      account_id: accountId,
      folder_id: folderId,
      uid,
      message_key: `k${uid}`,
      file_path: `k${uid}.eml`,
      message_id: `<${uid}@example.test>`,
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-01-01T09:00:00.000Z',
      internal_date: '2026-01-01T09:00:00.000Z',
      subject: 'x',
      from_name: 'A',
      from_email: 'a@example.test',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: `{"seen":${seen},"flagged":false,"draft":false,"deleted":false,"answered":false}`,
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 30,
      snippet: 'x',
      parsed_ok: 1,
      parse_error: null,
      body_text: 'x',
      body_html: null
    } as never)
  }

  it('per account, read-only accounts included, other folders left out', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-badge-'))
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    const ids = ['writable', 'readonly', 'empty']
    const core = createMailCore({
      dataDir,
      accounts: ids.map((id) => ({
        id,
        readOnly: id !== 'writable',
        email: `${id}@example.test`,
        host: '127.0.0.1',
        port: 1,
        security: 'none' as const,
        credentials: async () => ({ user: `${id}@example.test`, pass: 'x' })
      }))
    })
    cleanups.push(() => core.close())
    const entries = (core as unknown as { entries: Map<string, { store: Store }> }).entries

    const writable = entries.get('writable')!.store
    const inbox = writable.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    const archive = writable.upsertFolder({
      imapPath: 'Archive',
      delimiter: '/',
      uidValidity: '1'
    })
    addMessage(writable, 'writable', inbox.id, false)
    addMessage(writable, 'writable', inbox.id, false)
    addMessage(writable, 'writable', inbox.id, true)
    addMessage(writable, 'writable', archive.id, false)

    const readonly = entries.get('readonly')!.store
    const roInbox = readonly.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    addMessage(readonly, 'readonly', roInbox.id, false)

    const counts = await core.getInboxUnread()
    expect(counts).toEqual({ writable: 2, readonly: 1, empty: 0 })
    expect(inboxUnreadTotal(counts)).toBe(3)
  })
})
