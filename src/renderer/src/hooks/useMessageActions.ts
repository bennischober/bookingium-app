import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'
import { type UseInfiniteQueryResult, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { mailApi } from '@/lib/mailApi'
import { confirmAction } from '@/lib/confirm'
import { hide, unhide, visible } from '@/components/mail/optimistic'
import { archivedCount, uncoveredIds } from '@/components/mail/archiveActions'
import { PAGE_SIZE } from '@/components/mail/paging'
import {
  EMPTY_SELECTION,
  type Selection,
  nextAfterRemoval,
  single
} from '@/components/mail/selection'
import { folderLabel } from '@/components/mail/format'
import type {
  FolderNode,
  MessageListItem,
  OpSummary,
  SearchResult
} from '../../../main/mailclient/core/types'

export type MoveTarget =
  | { kind: 'delete' }
  | { kind: 'archive' }
  | { kind: 'folder'; folder: FolderNode }
const MOVE_TEXTS: Record<
  MoveTarget['kind'],
  { done: (folder: string) => string; many: (n: number, folder: string) => string; failed: string }
> = {
  delete: {
    done: () => 'In den Papierkorb verschoben',
    many: (n) => `${n} E-Mails in den Papierkorb verschoben`,
    failed: 'Löschen fehlgeschlagen'
  },
  archive: {
    done: () => 'Archiviert',
    many: (n) => `${n} E-Mails archiviert`,
    failed: 'Archivieren fehlgeschlagen'
  },
  folder: {
    done: (folder) => `Nach „${folder}“ verschoben`,
    many: (n, folder) => `${n} E-Mails nach „${folder}“ verschoben`,
    failed: 'Verschieben fehlgeschlagen'
  }
}

/**
 * R4: the mail page's message actions - read, flag, move, archive, trash, expunge, empty Trash -
 * and the optimistic hiding that makes them feel instant; `listItems` is the list without the
 * hidden rows
 */
export function useMessageActions({
  accountId,
  searching,
  results,
  messages,
  allFolders,
  setSelection,
  refreshLists,
  failed
}: {
  accountId: string
  searching: boolean
  results: UseInfiniteQueryResult<SearchResult>
  messages: UseInfiniteQueryResult<MessageListItem[]>
  allFolders: FolderNode[]
  setSelection: Dispatch<SetStateAction<Selection>>
  refreshLists: () => void
  failed: (title: string) => (error: unknown) => void
}) {
  const queryClient = useQueryClient()
  // G2/L1: mails the user just moved away are hidden at click time, before the server has
  // answered, so the next mail is immediately selectable and a quick delete-run feels instant.
  // The set is cleared as soon as fresh list data arrives (see the effect below), and a
  // failed move puts its ids back - the row reappears rather than silently vanishing.
  const [hiddenIds, setHiddenIds] = useState<number[]>([])
  const hideMails = (ids: number[]) => setHiddenIds((current) => hide(current, ids))
  const unhideMails = (ids: number[]) => setHiddenIds((current) => unhide(current, ids))

  // G7: a hidden mail stays hidden while it is still in the list data.
  //
  // Clearing the whole set whenever fresh list data arrived was wrong: an op-event triggers a
  // refresh 300 ms after the op STARTS, so a slow move had its rows put back on screen while
  // still in flight - the user saw the mail they just deleted reappear, which is the flicker this
  // whole fix exists to remove. A sync can do the same.
  //
  // So a hidden id is released when the fresh data no longer contains it: at that point the mail
  // has really left this folder (or the server has it elsewhere), and the list is already correct.
  // While it is still listed, its op has not landed and it stays hidden. A failed op restores it
  // explicitly through unhideMails.
  const listUpdatedAt = searching ? results.dataUpdatedAt : messages.dataUpdatedAt
  useEffect(() => {
    if (!listUpdatedAt) return
    const listed = new Set(
      (searching
        ? (results.data?.pages.flatMap((page) => page.items) ?? [])
        : (messages.data?.pages.flat() ?? [])
      ).map((m) => m.id)
    )
    setHiddenIds((current) => current.filter((id) => listed.has(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listUpdatedAt])

  const listItems = visible(
    searching
      ? (results.data?.pages.flatMap((p) => p.items) ?? [])
      : (messages.data?.pages.flat() ?? []),
    hiddenIds
  )

  const afterFlags = () => {
    refreshLists()
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'message'] })
  }
  const markRead = (ids: number[], read: boolean) => {
    mailApi
      .markRead(ids, read, accountId)
      .then(afterFlags)
      .catch(
        failed(
          read ? 'Als gelesen markieren fehlgeschlagen' : 'Als ungelesen markieren fehlgeschlagen'
        )
      )
  }
  const markFlagged = (ids: number[], flagged: boolean) => {
    mailApi
      .markFlagged(ids, flagged, accountId)
      .then(afterFlags)
      .catch(failed('Markierung fehlgeschlagen'))
  }

  // Moves the mails, moves the selection on if it held them, then reports how
  // the journaled moves went and offers to undo them all
  const moveAway = async (ids: number[], target: MoveTarget) => {
    if (ids.length === 0) return
    const order = listItems.map((m) => m.id)
    const texts = MOVE_TEXTS[target.kind]
    const label = target.kind === 'folder' ? folderLabel(target.folder) : ''

    // G2/L1: the click is answered now, not when the server answers. The rows go, the
    // selection moves on to the next mail, and the request runs behind that - so deleting a
    // run of mails is as fast as the user can click. A failure puts the rows back.
    hideMails(ids)
    const next = nextAfterRemoval(order, ids)
    setSelection((current) =>
      current.ids.some((id) => ids.includes(id))
        ? next !== null
          ? single(next)
          : EMPTY_SELECTION
        : current
    )

    let ops: OpSummary[]
    try {
      if (target.kind === 'delete') ops = await mailApi.deleteToTrash(ids, accountId)
      else if (target.kind === 'archive') ops = await mailApi.archive(ids, accountId)
      else ops = await mailApi.moveToFolder(ids, target.folder.id, accountId)
    } catch (error) {
      // the move never happened: the rows come back, and the user sees why
      unhideMails(ids)
      failed(texts.failed)(error)
      return
    }
    refreshLists()
    const done = ops.filter((op) => op.state === 'done')
    const undo =
      done.length > 0
        ? {
            label: 'Rückgängig',
            onClick: () => {
              void (async () => {
                try {
                  // Last move first, so each mail goes back the way it came
                  for (const op of [...done].reverse()) await mailApi.undoOp(op.id, accountId)
                } catch (error) {
                  failed('Rückgängig machen fehlgeschlagen')(error)
                }
                refreshLists()
              })()
            }
          }
        : undefined
    // MR-36: every mail the answer does not cover is shown again - the archive case returns no op
    // for a self-move, and a mixed selection skips the mails already in Archive. The rows come from
    // the whole list: a drag or the reading pane moves mails that are not part of the selection.
    const itemsById = new Map(listItems.map((m) => [m.id, m]))
    const moved = ids
      .map((id) => itemsById.get(id))
      .filter((m): m is MessageListItem => m !== undefined)
    const stillHidden = uncoveredIds(moved, ops, allFolders)
    if (stillHidden.length > 0) unhideMails(stillHidden.map((m) => m.id))

    const notDone = ops.filter((op) => op.state !== 'done')
    if (notDone.length > 0) {
      // A pending op stays journaled and is retried, but its mail is not on the server yet:
      // show it again rather than hiding a mail that has not actually moved
      unhideMails(ids)
      const reason = notDone.some((op) => op.state === 'pending')
        ? 'Der Server war nicht erreichbar; es wird beim nächsten Start erneut versucht.'
        : (notDone.find((op) => op.error)?.error ?? undefined)
      toast.error(texts.failed, {
        description:
          ids.length > 1
            ? `${notDone.length} von ${ids.length} E-Mails wurden nicht verschoben.${reason ? ` ${reason}` : ''}`
            : reason,
        action: undo
      })
      return
    }
    // MR-36 / README renderer 20: the toast says what the core archived, not how many were selected
    const archived = target.kind === 'archive' ? archivedCount(moved, ops, allFolders) : ids.length
    toast.success(archived > 1 ? texts.many(archived, label) : texts.done(label), { action: undo })
  }

  // B5: permanent deletion, only ever inside Trash and only for writable accounts
  const expunge = async (ids: number[]) => {
    const count = ids.length
    const confirmed = await confirmAction({
      title: count > 1 ? `${count} E-Mails endgültig löschen?` : 'Diese E-Mail endgültig löschen?',
      description: 'Das kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Endgültig löschen',
      destructive: true
    })
    if (!confirmed) return
    // G6/L1: the rows leave the list at click time, like a normal delete. A permanent delete is
    // the slowest write there is (flags + UID EXPUNGE), and it used to leave the mail on screen
    // for the whole round-trip. A failure puts the rows back.
    hideMails(ids)
    setSelection(EMPTY_SELECTION)
    try {
      await mailApi.expungeFromTrash(ids, accountId)
    } catch (error) {
      unhideMails(ids)
      failed('Endgültig löschen fehlgeschlagen')(error)
      return
    }
    refreshLists()
    toast.success(count > 1 ? `${count} E-Mails endgültig gelöscht` : 'Endgültig gelöscht')
  }

  // B5: "Papierkorb leeren" from the folder's context menu
  const emptyTrash = async (trash: FolderNode) => {
    const total = trash.totalCount ?? 0
    if (total === 0) {
      toast.info('Der Papierkorb ist leer.')
      return
    }
    const confirmed = await confirmAction({
      title: `${total.toLocaleString('de-DE')} E-Mails endgültig löschen?`,
      description: 'Das kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Papierkorb leeren',
      destructive: true
    })
    if (!confirmed) return
    // G6/L1: the folder empties on screen at once. Collecting the ids and expunging them in
    // chunks is many round-trips, so the Trash used to stay full for the whole time. The ids are
    // hidden as they are found, and a failure puts back what has not been deleted.
    const ids: number[] = []
    try {
      // The core takes ids, not a folder: collect them first, then delete in chunks.
      // A failed expunge keeps its row, so the loop must not depend on the folder shrinking.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await mailApi.listMessages(trash.id, { offset, limit: PAGE_SIZE }, accountId)
        ids.push(...page.map((m) => m.id))
        // the collected page is hidden right away, so the list shrinks as it is read
        hideMails(page.map((m) => m.id))
        if (page.length < PAGE_SIZE) break
      }
      for (let i = 0; i < ids.length; i += PAGE_SIZE) {
        await mailApi.expungeFromTrash(ids.slice(i, i + PAGE_SIZE), accountId)
      }
    } catch (error) {
      // whatever has not been deleted comes back
      unhideMails(ids)
      failed('Papierkorb leeren fehlgeschlagen')(error)
      refreshLists()
      return
    }
    setSelection(EMPTY_SELECTION)
    refreshLists()
    toast.success(`${total.toLocaleString('de-DE')} E-Mails endgültig gelöscht`)
  }

  return {
    setHiddenIds,
    listItems,
    markRead,
    markFlagged,
    moveAway,
    expunge,
    emptyTrash
  }
}
