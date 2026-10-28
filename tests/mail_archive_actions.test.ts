// MR-36: archiving a mail that is ALREADY in Archive hid it until a restart.
//
// `hasArchive` is global (does an Archive folder exist at all), so the action was offered inside Archive
// too. The core skips a self-move ("a mail already in the target is skipped", core/index.ts:482-484) and
// returns no op for it, while the G7 release effect only shows a mail again once it has left the list - so
// the rows disappeared and stayed gone until an account switch or a restart. A mixed selection did the same.
//
// Two pure decisions come out of this, and they are shaped by what the core actually returns: an
// `OpSummary` carries ONE `uid` (a plain move) or is a `move_batch` with `uid: null`, and there is no id
// list on it - so coverage is decided by source folder plus uid, and a done batch covers its whole folder.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  archiveableIds,
  archivedCount,
  uncoveredIds,
  type ArchiveItem,
  type MoveOp
} from '@/components/mail/archiveActions'
import type { FolderNode } from '../../src/main/mailclient/core/types'

const folder = (over: Partial<FolderNode>): FolderNode =>
  ({
    id: 'f',
    path: 'X',
    name: 'X',
    delimiter: '/',
    specialUse: null,
    unreadCount: 0,
    totalCount: 0,
    children: [],
    ...over
  }) as FolderNode

const ARCHIVE = folder({ id: 'a', path: 'Archive', specialUse: '\\Archive' })
const INBOX = folder({ id: 'i', path: 'INBOX' })
const TRASH = folder({ id: 't', path: 'Trash', specialUse: '\\Trash' })

/** A list item as the page has it: the row id plus the uid the op will carry */
const item = (id: number, folderId: string, uid = id): ArchiveItem => ({ id, folderId, uid })
/** The part of an OpSummary the decision reads: a plain move out of INBOX unless told otherwise */
const op = (uid: number | null, state: MoveOp['state'] = 'done', folderPath = 'INBOX'): MoveOp => ({
  kind: 'move',
  uid,
  state,
  folderPath
})
/** What the core returns for two or more mails out of one folder: one op, no uid */
const batch = (folderPath: string, state: MoveOp['state'] = 'done'): MoveOp => ({
  kind: 'move_batch',
  uid: null,
  state,
  folderPath
})
const FOLDERS = [ARCHIVE, INBOX, TRASH]

describe('MR-36: which mails an archive may act on', () => {
  it('drops the ones already in Archive', () => {
    // The regression: archiving inside Archive sent a self-move the core refuses, and the rows stayed
    // hidden because no op covered them.
    expect(archiveableIds([item(1, 'i'), item(2, 'a'), item(3, 'i')], [ARCHIVE, INBOX])).toEqual([
      1, 3
    ])
  })

  it('drops mails in Trash as well', () => {
    // Archiving out of Trash would be a move the user did not ask for
    expect(archiveableIds([item(1, 't')], [TRASH, ARCHIVE])).toEqual([])
  })

  it('keeps a mail whose folder is not in the list', () => {
    // it is not silently dropped just because the folder list has not caught up
    expect(archiveableIds([item(1, 'unbekannt')], [ARCHIVE])).toEqual([1])
  })
})

describe('MR-36: which hidden mails an answer covers', () => {
  it('reports every hidden mail no done op mentions', () => {
    // The other half: a mixed selection archived one mail and skipped the rest, and the skipped ones
    // stayed hidden. Every mail no done op covers is shown again.
    const hidden = [item(1, 'i', 11), item(2, 'i', 12), item(3, 'i', 13)]
    const ops = [op(11), op(12)]
    expect(uncoveredIds(hidden, ops, FOLDERS).map((i) => i.id)).toEqual([3])
  })

  it('ignores an op that did not finish', () => {
    // A pending op is retried by the journal; its mail has not moved, so it must be shown again.
    expect(uncoveredIds([item(1, 'i', 11)], [op(11, 'pending')], FOLDERS).map((i) => i.id)).toEqual(
      [1]
    )
  })

  it('reports every mail when the answer is empty', () => {
    // exactly the Archive case: the core returns [] for a self-move
    expect(uncoveredIds([item(1, 'i'), item(2, 'i')], [], FOLDERS).map((i) => i.id)).toEqual([1, 2])
  })

  it('reports nothing when every mail is covered', () => {
    expect(uncoveredIds([item(1, 'i', 11)], [op(11)], FOLDERS)).toEqual([])
  })

  it('a done move_batch covers every mail of its source folder', () => {
    // Review of I10: two or more mails out of one folder are ONE move_batch op with uid null, so a
    // uid-only check showed every successfully moved mail again and counted 0 archived.
    const hidden = [item(1, 'i', 11), item(2, 'i', 12), item(3, 't', 13)]
    expect(uncoveredIds(hidden, [batch('INBOX')], FOLDERS).map((i) => i.id)).toEqual([3])
  })

  it('a uid only covers the mail in the folder the op came from', () => {
    // UIDs are per folder: uid 11 moved out of INBOX says nothing about uid 11 in Trash
    const hidden = [item(1, 'i', 11), item(2, 't', 11)]
    expect(uncoveredIds(hidden, [op(11)], FOLDERS).map((i) => i.id)).toEqual([2])
  })

  it('an unfinished batch covers nothing', () => {
    expect(uncoveredIds([item(1, 'i')], [batch('INBOX', 'failed')], FOLDERS)).toHaveLength(1)
  })
})

describe('MR-36: the toast counts what the core archived', () => {
  it('counts the archived mails, not the selection', () => {
    // README renderer 20: the toast said "3 E-Mails archiviert" while the core archived 1.
    const items = [item(1, 'i', 11), item(2, 'i', 12), item(3, 'i', 13)]
    expect(archivedCount(items, [op(11)], FOLDERS)).toBe(1)
  })

  it('counts each mail once even when several ops mention it', () => {
    const items = [item(1, 'i', 11), item(2, 'i', 12)]
    expect(archivedCount(items, [op(11), op(11)], FOLDERS)).toBe(1)
  })

  it('counts every mail of a done batch', () => {
    const items = [item(1, 'i', 11), item(2, 'i', 12), item(3, 'i', 13)]
    expect(archivedCount(items, [batch('INBOX')], FOLDERS)).toBe(3)
  })
})

describe('MR-36: the page wiring', () => {
  const page = (): string =>
    readFileSync(join(process.cwd(), 'src/renderer/src/pages/MailPage.tsx'), 'utf8')
  // R4: the message actions and the optimistic hiding live in the page's useMessageActions hook
  const actions = (): string =>
    readFileSync(join(process.cwd(), 'src/renderer/src/hooks/useMessageActions.ts'), 'utf8')

  it('filters the archive ids and hides the action when nothing qualifies', () => {
    // The visible half of the fix. Both are pinned by source because MailPage cannot be rendered here.
    const src = page()
    expect(src).toContain('archiveableIds(selectedItems, allFolders)')
    // the action must not be offered unconditionally
    expect(src).not.toContain(
      "archive: hasArchive ? (ids) => void moveAway(ids, { kind: 'archive' })"
    )
    expect(src).toContain('archiveable.length > 0')
  })

  it('shows again every mail the answer does not cover', () => {
    // Without this the skipped rows stayed hidden until a restart, which was the reported symptom.
    const src = actions()
    expect(src).toContain('uncoveredIds(moved, ops, allFolders)')
    expect(src).toContain('unhideMails(stillHidden.map((m) => m.id))')
  })

  it('the toast counts what the core archived, not the selection', () => {
    const src = actions()
    expect(src).toContain(
      "target.kind === 'archive' ? archivedCount(moved, ops, allFolders) : ids.length"
    )
  })
})
