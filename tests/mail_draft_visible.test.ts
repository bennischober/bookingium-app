// G5: a saved draft appears in the Drafts folder at once, not after a resync.
//
// The person reported that a draft takes a long time to appear. Cause: a saved draft had NO local row.
// It became visible only after the IMAP APPEND finished AND the Drafts folder had been resynced, which
// re-downloaded the very message the client had just uploaded - two round-trips before anything showed.
//
// The fix stores the appended message locally through the same parse/insert path a synced mail uses.
//
// IMPORTANT - why this test drives the real op and not the helper: an earlier version called
// storeAppendedDraft() directly and passed with the wiring removed, so it proved the helper worked while
// the product was still broken. This version runs the actual draft_save op through WriteEngine.execute and
// asserts the hook fired. Removing the call in doDraftSave turns it red.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store, type JournalRow } from '../src/main/mailclient/core/store'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'
import { sandboxCredentials, sandboxWriteAccount } from './helpers/writeAccount'

const ACCOUNT = 'g5'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; draftsPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-g5op-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  store.upsertFolder({ imapPath: 'Drafts', delimiter: '/', specialUse: '\\Drafts' })
  store.upsertFolder({ imapPath: 'Trash', delimiter: '/', specialUse: '\\Trash' })
  // uid_validity is a folder column; the engine reads it when building the message key
  store.db.prepare("UPDATE folders SET uid_validity = '77' WHERE imap_path = 'Drafts'").run()
  return { store, draftsPath: 'Drafts' }
}

const draftMime = (subject: string): Buffer =>
  Buffer.from(
    [
      'From: a@example.test',
      'To: b@example.test',
      `Subject: ${subject}`,
      'Message-ID: <draft-1@example.test>',
      'Date: Thu, 01 Jan 2026 09:00:00 +0000',
      '',
      'Entwurfstext',
      ''
    ].join('\r\n')
  )

/** A connection stub: APPEND succeeds and returns a UID, nothing else is needed */
function stubClient(): { append: (...args: unknown[]) => Promise<{ uid: number }> } {
  return {
    append: async () => ({ uid: 42 })
  }
}

describe('G5: the draft_save op stores the draft locally', () => {
  it('fires the local-store hook after a successful APPEND', async () => {
    const { store, draftsPath } = openStore()
    const writes = new WriteEngine(store, ACCOUNT, {
      writeAccount: sandboxWriteAccount(),
      credentials: sandboxCredentials
    })
    ;(writes as unknown as { writeClient: () => Promise<unknown> }).writeClient = async () =>
      stubClient()

    // Record what the engine asks the sync side to do
    const stored: { folderPath: string; uid: number; flags?: Set<string> }[] = []
    writes.attachEngine({
      withFolderMutex: (_p, fn) => fn(),
      triggerResync: () => undefined,
      storeAppendedDraft: async (folderPath, _validity, uid, _source, flags) => {
        stored.push({ folderPath, uid, flags })
      }
    })

    const mime = draftMime('Mein Entwurf')
    const opId = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'draft_save',
      folderPath: draftsPath,
      folderUidValidity: '77',
      payload: { mime: mime.toString('base64') }
    })
    const op = store.journalGet(opId) as JournalRow
    const result = await writes.execute(op)

    expect(result.outcome).toBe('done')
    // The assertion the old behaviour failed: nothing was stored locally, so the draft stayed invisible
    expect(stored).toHaveLength(1)
    expect(stored[0].uid).toBe(42)
    expect(stored[0].folderPath).toBe('Drafts')
    // F12: \Draft, never \Seen, so the folder count shows it
    expect(stored[0].flags?.has('\\Draft')).toBe(true)
    expect(stored[0].flags?.has('\\Seen')).toBe(false)
  })
})
