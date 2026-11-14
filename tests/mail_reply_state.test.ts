// #163: answered (\Answered) and forwarded ($Forwarded) reach the lists. The store keeps
// both in flags_json, threads aggregate them, and a forward marks its source mail.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import {
  FORWARDED_KEYWORD,
  flagKey,
  flagsFromSet,
  parseStoredFlags,
  sameFlags
} from '../src/main/mailclient/core/message_ingest'
import { OpApi, type OpApiContext } from '../src/main/mailclient/core/op_api'
import type { AccountEntry } from '../src/main/mailclient/core/index'

const ACCOUNT = 'acc'
const OLD_FLAGS = '{"seen":true,"flagged":false,"draft":false,"deleted":false,"answered":false}'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-reply-state-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  cleanups.push(() => store.close())
  return store
}

function addMessage(store: Store, folderId: string, uid: number, threadId: string, flags: string) {
  return store.insertMessage({
    account_id: ACCOUNT,
    folder_id: folderId,
    uid,
    message_key: store.messageKey(ACCOUNT, folderId, '7', uid),
    file_path: `m-${uid}.eml`,
    message_id: `<${uid}@example.test>`,
    in_reply_to: null,
    references_json: '[]',
    thread_id: threadId,
    date: `2026-01-0${uid}T09:00:00.000Z`,
    internal_date: `2026-01-0${uid}T09:00:00.000Z`,
    subject: `mail ${uid}`,
    from_name: 'Absender',
    from_email: 'absender@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: flags,
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 100,
    snippet: `mail ${uid}`,
    parsed_ok: 1,
    parse_error: null,
    body_text: `body ${uid}`,
    body_html: null
  })
}

describe('flag names', () => {
  it('maps system flags and the $Forwarded keyword to their stored keys', () => {
    expect(flagKey('\\Answered')).toBe('answered')
    expect(flagKey('\\Seen')).toBe('seen')
    expect(flagKey(FORWARDED_KEYWORD)).toBe('forwarded')
    expect(flagKey('$forwarded')).toBe('forwarded')
    expect(flagKey('$Junk')).toBeNull()
    expect(flagKey('\\Recent')).toBeNull()
  })

  it('reads forwarded from the server flag set, case-insensitively', () => {
    expect(flagsFromSet(new Set(['\\Answered'])).answered).toBe(true)
    expect(flagsFromSet(new Set(['$Forwarded'])).forwarded).toBe(true)
    expect(flagsFromSet(new Set(['$FORWARDED'])).forwarded).toBe(true)
    expect(flagsFromSet(new Set(['\\Seen'])).forwarded).toBe(false)
  })

  it('treats a row stored before forwarded existed as unchanged, not as a flag change', () => {
    expect(parseStoredFlags(OLD_FLAGS).forwarded).toBe(false)
    expect(sameFlags(OLD_FLAGS, flagsFromSet(new Set(['\\Seen'])))).toBe(true)
    expect(sameFlags(OLD_FLAGS, flagsFromSet(new Set(['\\Seen', '$Forwarded'])))).toBe(false)
  })
})

describe('threads', () => {
  it('carry answered and forwarded when any of their messages has it', () => {
    const store = openStore()
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '7' })
    addMessage(store, inbox.id, 1, 't-a', OLD_FLAGS)
    addMessage(store, inbox.id, 2, 't-a', OLD_FLAGS.replace('"answered":false', '"answered":true'))
    addMessage(store, inbox.id, 3, 't-f', OLD_FLAGS.replace('}', ',"forwarded":true}'))
    addMessage(store, inbox.id, 4, 't-n', OLD_FLAGS)

    const byId = new Map(store.listThreads(inbox.id, 0, 50).map((t) => [t.threadId, t]))
    expect(byId.get('t-a')).toMatchObject({ answered: true, forwarded: false })
    expect(byId.get('t-f')).toMatchObject({ answered: false, forwarded: true })
    expect(byId.get('t-n')).toMatchObject({ answered: false, forwarded: false })
  })
})

describe('a forward', () => {
  it('stores $Forwarded under forwarded and queues the keyword for the server', () => {
    const store = openStore()
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '7' })
    const id = addMessage(store, inbox.id, 1, 't-1', OLD_FLAGS)
    const ops = new OpApi({
      parseFlags: (row) => parseStoredFlags(row.flags_json)
    } as unknown as OpApiContext)
    const entry = { store, config: { id: ACCOUNT } } as unknown as AccountEntry

    const [opId] = ops.planFlagOp(entry, [id], { add: [FORWARDED_KEYWORD] })

    const stored = JSON.parse(store.getMessage(id)!.flags_json)
    expect(stored).toMatchObject({ seen: true, answered: false, forwarded: true })
    expect(stored).not.toHaveProperty('$forwarded')
    expect(JSON.parse(store.journalGet(opId)!.payload!)).toEqual({
      add: [FORWARDED_KEYWORD],
      remove: []
    })
  })
})
