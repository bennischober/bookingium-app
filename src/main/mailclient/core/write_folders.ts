// R3: the folder ops, out of core/write_engine.ts: create, rename and delete, each with the
// local half that makes a replay after a crash finish the change.
import type { ImapFlow } from 'imapflow'
import type { Store, JournalRow } from './store.js'
import { isPathOrChild } from './folders.js'
import type { OpResult } from './write_engine.js'


/** I8 (MR-06): the start of a folder_delete conflict reason when the server's folder is not empty */
export const FOLDER_DELETE_REFUSED = 'folder not empty'

/** What the folder ops need from the engine. */
export interface WriteFoldersContext {
  readonly store: Store
  writeClient(): Promise<ImapFlow>
}

export class WriteFolders {
  constructor(private readonly ctx: WriteFoldersContext) {}

  private get store(): Store { return this.ctx.store }
  private writeClient(): Promise<ImapFlow> { return this.ctx.writeClient() }

  // ----- folders (B1) -------------------------------------------------------
  /**
   * B1: one op per folder change, journaled like every other write.
   *
   * Idempotent replay is what makes a crash safe: a create whose folder exists
   * is done, a rename whose target exists and whose source is gone is done, and a
   * delete of a folder that is gone is done. Each of them then finishes its local
   * half, so a crash between the server call and the local update resumes.
   */
  async doFolderCreate(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as { path?: string; delimiter?: string }
    const path = payload.path
    if (!path) return { outcome: 'conflict', reason: 'folder_create without path' }
    const client = await this.writeClient()
    try {
      const existing = await this.folderExists(client, path)
      if (existing) {
        // A replay of a create that already ran: keep the local row and be done
        this.store.upsertFolder({ imapPath: path, delimiter: payload.delimiter ?? '/' })
        return { outcome: 'done', detail: 'resumed: folder already exists' }
      }
      await client.mailboxCreate(path)
      this.store.upsertFolder({ imapPath: path, delimiter: payload.delimiter ?? '/' })
      return { outcome: 'done' }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  async doFolderRename(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as {
      from?: string
      to?: string
      delimiter?: string
    }
    const from = payload.from
    const to = payload.to
    if (!from || !to) return { outcome: 'conflict', reason: 'folder_rename without from/to' }
    const delimiter = payload.delimiter ?? '/'
    const client = await this.writeClient()
    try {
      const targetExists = await this.folderExists(client, to)
      const sourceExists = await this.folderExists(client, from)
      // Replay of a rename that already ran: the target is there, the source is not
      const alreadyRenamed = targetExists && !sourceExists
      if (!alreadyRenamed) {
        if (!sourceExists) {
          return { outcome: 'conflict', reason: `folder gone: ${from}` }
        }
        if (targetExists) {
          return { outcome: 'conflict', reason: `target exists: ${to}` }
        }
        await client.mailboxRename(from, to)
      }
      // Local half: SELECT the new path and compare UIDVALIDITY. The same
      // UIDVALIDITY means the mail is still valid, so the rows are re-keyed;
      // a different one drops them and the normal swap re-downloads.
      let keepUids = true
      try {
        const before = this.store.getFolderByPath(from)
        const after = await client.mailboxOpen(to)
        const afterValidity = String(after.uidValidity)
        if (before?.uid_validity && before.uid_validity !== afterValidity) keepUids = false
        this.store.rekeyFolder(from, to, keepUids)
        // the new UIDVALIDITY is what the next sync compares against
        this.store.upsertFolder({ imapPath: to, delimiter, uidValidity: afterValidity })
      } catch {
        // Cannot confirm: keep the rows, a resync corrects them
        this.store.rekeyFolder(from, to, true)
      }
      return { outcome: 'done', detail: alreadyRenamed ? 'resumed: already renamed' : undefined }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  async doFolderDelete(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as { path?: string }
    const path = payload.path
    if (!path) return { outcome: 'conflict', reason: 'folder_delete without path' }
    const client = await this.writeClient()
    try {
      const list = await client.list()
      const listed = list.find((f) => f.path === path)
      const exists = Boolean(listed)
      if (listed) {
        // I8 (MR-06): IMAP DELETE takes the folder's mail with it, past Trash. The core
        // checked its local copy before journaling; that copy misses mail another client
        // moved in since, so the server is asked here, right before the DELETE.
        const delimiter = listed.delimiter || '/'
        if (list.some((f) => f.path !== path && isPathOrChild(f.path, path, delimiter))) {
          return { outcome: 'conflict', reason: `${FOLDER_DELETE_REFUSED}: subfolders on the server` }
        }
        // imapflow answers false when STATUS failed: not known to be empty, so not deleted now
        const status = await client.status(path, { messages: true })
        if (!status) return { outcome: 'failed', reason: 'folder_delete: STATUS failed' }
        if (status.messages !== 0) {
          return { outcome: 'conflict', reason: `${FOLDER_DELETE_REFUSED}: ${status.messages ?? 'unknown'} mails on the server` }
        }
        await client.mailboxDelete(path)
      }
      const local = this.store.getFolderByPath(path)
      if (local) this.store.deleteFolderRow(local.id)
      return { outcome: 'done', detail: exists ? undefined : 'resumed: already gone' }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  /** Whether the server lists this path right now */
  private async folderExists(client: ImapFlow, path: string): Promise<boolean> {
    const list = await client.list()
    return list.some((f) => f.path === path)
  }
}
