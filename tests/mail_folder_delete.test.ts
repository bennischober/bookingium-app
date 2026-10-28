// I8 (MR-06): IMAP DELETE removes a folder together with its mail, past Trash. The core
// checks its local copy before journaling; the op asks the server (LIST for subfolders,
// STATUS for MESSAGES) right before the DELETE, and the undo of a folder_create runs the
// same checks as deleteFolder.
//
// The write engine runs against a stubbed IMAP client, the core with a stubbed engine:
// no server, no sandbox, no mail content.
import { sandboxWriteAccount, sandboxCredentials } from './helpers/writeAccount'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMailCore } from '../src/main/mailclient/core/index'
import { Store, type JournalRow } from '../src/main/mailclient/core/store'
import { FOLDER_DELETE_REFUSED, WriteEngine } from '../src/main/mailclient/core/write_engine'
import type { OpResult } from '../src/main/mailclient/core/write_engine'

const ACCOUNT = 'acc'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

function openStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-folder-delete-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return store
}

/** One message in a folder, for the local count */
function addMessage(store: Store, folderId: string, uid: number): void {
  store.insertMessage({
    account_id: ACCOUNT,
    folder_id: folderId,
    uid,
    message_key: `key-${folderId}-${uid}`,
    file_path: `key-${uid}.eml`,
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
    flags_json: '{"seen":true,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 30,
    snippet: 'x',
    parsed_ok: 1,
    parse_error: null,
    body_text: 'x',
    body_html: null
  })
}

type Call = { method: string; args: unknown[] }

/** The server's folder list and the MESSAGES count STATUS reports (false: STATUS failed) */
function stubClient(paths: string[], messages: number | false) {
  const calls: Call[] = []
  const client = {
    list: async () => {
      calls.push({ method: 'list', args: [] })
      return paths.map((p) => ({ path: p, delimiter: '/' }))
    },
    status: async (p: string) => {
      calls.push({ method: 'status', args: [p] })
      return messages === false ? false : { path: p, messages }
    },
    mailboxDelete: async (p: string) => {
      calls.push({ method: 'mailboxDelete', args: [p] })
      return { path: p }
    },
    logout: async () => undefined
  }
  return { client, calls }
}

function deleteOp(store: Store, folder: string): JournalRow {
  const id = store.journalEnqueue({
    accountId: ACCOUNT,
    kind: 'folder_delete',
    folderPath: folder,
    payload: { path: folder }
  })
  return store.journalGet(id)!
}

async function runDelete(store: Store, client: unknown, folder: string) {
  const writes = new WriteEngine(store, ACCOUNT, {
    writeAccount: sandboxWriteAccount(),
    credentials: sandboxCredentials
  })
  const internals = writes as unknown as {
    writeClient: () => Promise<unknown>
    execute: (op: JournalRow) => Promise<{ outcome: string; reason?: string; detail?: string }>
  }
  internals.writeClient = async () => client
  return internals.execute(deleteOp(store, folder))
}

describe('folder_delete asks the server first (MR-06)', () => {
  it('refuses a folder the server reports mail in, and keeps it', async () => {
    const store = openStore()
    store.upsertFolder({ imapPath: 'Projekte', delimiter: '/', uidValidity: '1' })
    const { client, calls } = stubClient(['INBOX', 'Projekte'], 3)

    const result = await runDelete(store, client, 'Projekte')

    expect(result.outcome).toBe('conflict')
    expect(result.reason?.startsWith(FOLDER_DELETE_REFUSED)).toBe(true)
    expect(calls.map((c) => c.method)).not.toContain('mailboxDelete')
    expect(store.getFolderByPath('Projekte')).toBeTruthy()
  })

  it('refuses a folder with a subfolder on the server', async () => {
    const store = openStore()
    store.upsertFolder({ imapPath: 'Projekte', delimiter: '/', uidValidity: '1' })
    const { client, calls } = stubClient(['INBOX', 'Projekte', 'Projekte/Alt'], 0)

    const result = await runDelete(store, client, 'Projekte')

    expect(result.outcome).toBe('conflict')
    expect(result.reason?.startsWith(FOLDER_DELETE_REFUSED)).toBe(true)
    expect(calls.map((c) => c.method)).not.toContain('mailboxDelete')
  })

  it('deletes an empty folder; a neighbour with the same prefix is no subfolder', async () => {
    const store = openStore()
    store.upsertFolder({ imapPath: 'Projekte', delimiter: '/', uidValidity: '1' })
    const { client, calls } = stubClient(['INBOX', 'Projekte', 'Projekte2'], 0)

    const result = await runDelete(store, client, 'Projekte')

    expect(result.outcome).toBe('done')
    expect(calls.map((c) => c.method)).toEqual(['list', 'status', 'mailboxDelete'])
    expect(calls[1].args).toEqual(['Projekte'])
    expect(store.getFolderByPath('Projekte')).toBeFalsy()
  })

  it('does not delete when STATUS fails, and tries again later', async () => {
    const store = openStore()
    store.upsertFolder({ imapPath: 'Projekte', delimiter: '/', uidValidity: '1' })
    const { client, calls } = stubClient(['INBOX', 'Projekte'], false)

    const result = await runDelete(store, client, 'Projekte')

    expect(result.outcome).toBe('failed')
    expect(calls.map((c) => c.method)).not.toContain('mailboxDelete')
  })

  it('takes a folder the server no longer lists as already deleted', async () => {
    const store = openStore()
    store.upsertFolder({ imapPath: 'Projekte', delimiter: '/', uidValidity: '1' })
    const { client, calls } = stubClient(['INBOX'], 0)

    const result = await runDelete(store, client, 'Projekte')

    expect(result).toMatchObject({ outcome: 'done', detail: 'resumed: already gone' })
    expect(calls.map((c) => c.method)).toEqual(['list'])
  })
})

describe('deleteFolder and the undo of a create (MR-06)', () => {
  type Entry = {
    store: Store
    writes: {
      execute: (op: { id: string; kind: string }) => Promise<OpResult>
      requestResync: (path: string) => void
    }
  }

  /** A writable account whose write engine is a stub; the store is seeded first */
  function core(seed: (store: Store) => void, result: OpResult = { outcome: 'done' }) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-folder-delete-core-'))
    const dir = path.join(dataDir, ACCOUNT)
    fs.mkdirSync(dir, { recursive: true })
    const store = new Store(dir, ACCOUNT)
    seed(store)
    store.close()
    const api = createMailCore({
      dataDir,
      accounts: [
        {
          id: ACCOUNT,
          readOnly: false,
          email: 'a@example.test',
          host: '127.0.0.1',
          port: 1,
          security: 'none' as const,
          credentials: async () => ({ user: 'a@example.test', pass: 'x' })
        }
      ]
    })
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    cleanups.push(() => api.close())
    const entry = (api as unknown as { entries: Map<string, Entry> }).entries.get(ACCOUNT)!
    const execute = vi.fn<(op: { id: string; kind: string }) => Promise<OpResult>>(
      async () => result
    )
    entry.writes.execute = execute
    entry.writes.requestResync = vi.fn()
    return { api, entry, execute }
  }

  /** The folder "Neu" and the done folder_create that made it; returns the op id */
  function created(store: Store): string {
    store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    store.upsertFolder({ imapPath: 'Neu', delimiter: '/', uidValidity: '1' })
    const id = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'folder_create',
      folderPath: 'Neu',
      payload: { path: 'Neu', delimiter: '/' }
    })
    store.journalUpdate(id, { state: 'done' })
    return id
  }

  it('refuses to undo a create once mail was moved into the folder', async () => {
    let opId = ''
    const { api, execute } = core((store) => {
      opId = created(store)
      addMessage(store, store.getFolderByPath('Neu')!.id, 1)
    })

    await expect(api.undoOp(opId, ACCOUNT)).rejects.toThrow('enthält noch 1 E-Mails')
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses to undo a create once the folder has a subfolder', async () => {
    let opId = ''
    const { api, execute } = core((store) => {
      opId = created(store)
      store.upsertFolder({ imapPath: 'Neu/Unter', delimiter: '/', uidValidity: '1' })
    })

    await expect(api.undoOp(opId, ACCOUNT)).rejects.toThrow('Unterordner')
    expect(execute).not.toHaveBeenCalled()
  })

  it('undoes the create of a folder that is still empty', async () => {
    let opId = ''
    const { api, execute } = core((store) => {
      opId = created(store)
    })

    await api.undoOp(opId, ACCOUNT)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0].kind).toBe('folder_delete')
  })

  it('says so when the server refused the undo, instead of reporting it done', async () => {
    let opId = ''
    const { api } = core(
      (store) => {
        opId = created(store)
      },
      { outcome: 'conflict', reason: `${FOLDER_DELETE_REFUSED}: 2 mails on the server` }
    )

    await expect(api.undoOp(opId, ACCOUNT)).rejects.toThrow('auf dem Server')
  })

  it('says so when the server refused a delete, and resyncs the folder', async () => {
    const { api, entry } = core(
      (store) => {
        created(store)
      },
      { outcome: 'conflict', reason: `${FOLDER_DELETE_REFUSED}: subfolders on the server` }
    )

    await expect(api.deleteFolder('Neu', ACCOUNT)).rejects.toThrow('auf dem Server')
    expect(entry.writes.requestResync).toHaveBeenCalledWith('Neu')
    expect(entry.store.getFolderByPath('Neu')).toBeTruthy()
  })

  it('still refuses a delete of a folder with local mail before journaling anything', async () => {
    const { api, execute } = core((store) => {
      created(store)
      addMessage(store, store.getFolderByPath('Neu')!.id, 1)
    })

    await expect(api.deleteFolder('Neu', ACCOUNT)).rejects.toThrow('enthält noch 1 E-Mails')
    expect(execute).not.toHaveBeenCalled()
  })
})
