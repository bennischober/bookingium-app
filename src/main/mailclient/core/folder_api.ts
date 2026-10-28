// R2: the folder calls of MailCore, out of core/index.ts: create, rename, move and delete a
// folder, with the local refusals that run before a folder op is journaled and the one that
// reads the server's answer. MailCore keeps one-line delegations.
import type { JournalRow, FolderRow } from './store.js';
import { FOLDER_DELETE_REFUSED } from './write_engine.js';
import type { OpSummary } from './types.js';
import { checkFolderName, folderPath, folderMoveRefusal, folderMoveTarget, isPathOrChild, isProtectedFolder, DEFAULT_DELIMITER, FolderNameError } from './folders.js';
import type { AccountEntry } from './index.js';

/** What the folder calls need from the core. */
export interface FolderApiContext {
  writableEntry(id?: string): AccountEntry;
  replayOps(e: AccountEntry, opIds: string[]): Promise<void>;
  opToSummary(op: JournalRow): OpSummary;
}

export class FolderApi {
  constructor(private readonly ctx: FolderApiContext) {}

  private writableEntry(id?: string): AccountEntry { return this.ctx.writableEntry(id); }
  private replayOps(e: AccountEntry, opIds: string[]): Promise<void> { return this.ctx.replayOps(e, opIds); }
  private opToSummary(op: JournalRow): OpSummary { return this.ctx.opToSummary(op); }

  /** B1: a new folder under `parentPath`, or at the top level */
  async createFolder(parentPath: string | null, name: string, accountId?: string): Promise<OpSummary> {
    const e = this.writableEntry(accountId);
    const parent = parentPath ? e.store.getFolderByPath(parentPath) : null;
    if (parentPath && !parent) throw new FolderNameError(`Ordner nicht gefunden: ${parentPath}`);
    const delimiter = parent?.delimiter ?? DEFAULT_DELIMITER;
    checkFolderName(name, delimiter);
    const path = folderPath(parentPath, name, delimiter);
    if (e.store.getFolderByPath(path)) throw new FolderNameError(`Ordner existiert bereits: ${path}`);
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'folder_create',
      folderPath: path,
      payload: { path, delimiter },
    });
    await this.replayOps(e, [opId]);
    return this.opToSummary(e.store.journalGet(opId)!);
  }

  /** B1: rename a folder's own name; subfolders move with it */
  async renameFolder(path: string, newName: string, accountId?: string): Promise<OpSummary> {
    const e = this.writableEntry(accountId);
    const folder = e.store.getFolderByPath(path);
    if (!folder) throw new FolderNameError(`Ordner nicht gefunden: ${path}`);
    this.refuseProtectedFolder(folder);
    const delimiter = folder.delimiter || DEFAULT_DELIMITER;
    checkFolderName(newName, delimiter);
    const parentPath = path.includes(delimiter) ? path.slice(0, path.lastIndexOf(delimiter)) : null;
    const to = folderPath(parentPath, newName, delimiter);
    if (to === path) return this.opToSummary(e.store.journalListRecent(1)[0]);
    if (e.store.getFolderByPath(to)) throw new FolderNameError(`Ordner existiert bereits: ${to}`);
    // The whole subtree is renamed, so no op may be pending anywhere in it
    this.refusePendingOpsIn(e, path, delimiter);
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'folder_rename',
      folderPath: path,
      payload: { from: path, to, delimiter },
    });
    await this.replayOps(e, [opId]);
    return this.opToSummary(e.store.journalGet(opId)!);
  }

  /**
   * B2: move a folder under a new parent (drag and drop). It is the same rename op -
   * the folder keeps its name and only its parent path changes. Refused before any
   * server contact when the target is the folder itself, one of its own subfolders, or
   * when a folder of that name already exists there.
   */
  async moveFolder(path: string, newParentPath: string | null, accountId?: string): Promise<OpSummary> {
    const e = this.writableEntry(accountId)
    const folder = e.store.getFolderByPath(path)
    if (!folder) throw new FolderNameError(`Ordner nicht gefunden: ${path}`)
    const delimiter = folder.delimiter || DEFAULT_DELIMITER
    const knownPaths = e.store.allFolders().map((f) => f.imap_path)
    const refusal = folderMoveRefusal(path, newParentPath, {
      delimiter,
      specialUse: folder.special_use,
      knownPaths
    })
    if (refusal) throw new FolderNameError(refusal)
    const to = folderMoveTarget(path, newParentPath, delimiter)
    if (to === path) return this.opToSummary(e.store.journalListRecent(1)[0])
    // The whole subtree moves, so no op may be pending anywhere in it
    this.refusePendingOpsIn(e, path, delimiter)
    const opId = e.store.journalEnqueue({
      accountId: e.config.id,
      kind: 'folder_rename',
      folderPath: path,
      payload: { from: path, to, delimiter }
    })
    await this.replayOps(e, [opId])
    return this.opToSummary(e.store.journalGet(opId)!)
  }

  /**
   * B1: delete an empty folder.
   *
   * Deleting a folder with mail on IMAP deletes that mail permanently, so this
   * refuses a folder that still holds mail or has subfolders.
   */
  async deleteFolder(path: string, accountId?: string): Promise<OpSummary> {
    const e = this.writableEntry(accountId);
    this.refuseFolderDelete(e, path);
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'folder_delete',
      folderPath: path,
      payload: { path },
    });
    await this.replayOps(e, [opId]);
    this.throwIfServerRefusedDelete(e, opId);
    return this.opToSummary(e.store.journalGet(opId)!);
  }

  /**
   * B1, I8 (MR-06): the local checks before a folder_delete is journaled, for deleteFolder
   * and the undo of a create alike. The op asks the server again right before the DELETE.
   */
  refuseFolderDelete(e: AccountEntry, path: string): void {
    const folder = e.store.getFolderByPath(path);
    if (!folder) throw new FolderNameError(`Ordner nicht gefunden: ${path}`);
    this.refuseProtectedFolder(folder);
    const delimiter = folder.delimiter || DEFAULT_DELIMITER;
    const count = e.store.countByFolder(folder.id).total;
    if (count > 0) {
      throw new FolderNameError(
        `Der Ordner enthält noch ${count} E-Mails. Verschieben oder löschen Sie sie zuerst.`
      );
    }
    if (e.store.allFolders().some((f) => isPathOrChild(f.imap_path, path, delimiter) && f.imap_path !== path)) {
      throw new FolderNameError('Der Ordner enthält noch Unterordner. Löschen Sie sie zuerst.');
    }
    this.refusePendingOpsIn(e, path, delimiter);
  }

  /** I8 (MR-06): the server still had mail or subfolders there - say so instead of "gelöscht" */
  throwIfServerRefusedDelete(e: AccountEntry, opId: string): void {
    const op = e.store.journalGet(opId);
    if (op?.state === 'conflict' && (op.error ?? '').startsWith(FOLDER_DELETE_REFUSED)) {
      throw new FolderNameError(
        'Der Ordner enthält auf dem Server noch E-Mails oder Unterordner und wurde nicht gelöscht. ' +
        'Der Ordner wird neu abgeglichen.'
      );
    }
  }

  /** B1: INBOX and the special-use folders may never be renamed or deleted */
  private refuseProtectedFolder(folder: FolderRow): void {
    if (isProtectedFolder({ path: folder.imap_path, specialUse: folder.special_use })) {
      throw new FolderNameError('Dieser Ordner kann nicht umbenannt oder gelöscht werden.')
    }
  }

  /** B1: no folder op may race a pending one for the folder or its subfolders */
  private refusePendingOpsIn(e: AccountEntry, path: string, delimiter: string): void {
    const busy = e.store.journalPending(500).some((op) => {
      if (op.state !== 'pending' && op.state !== 'running') return false
      const paths = [op.folder_path, op.target_folder_path].filter(Boolean) as string[]
      return paths.some((p) => isPathOrChild(p, path, delimiter))
    })
    if (busy) {
      throw new FolderNameError(
        'Für diesen Ordner läuft noch eine Änderung. Bitte versuchen Sie es gleich noch einmal.'
      )
    }
  }
}
