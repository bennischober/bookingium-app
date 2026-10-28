import { type RefObject, useEffect } from 'react'
import { type ComposeState, emptyCompose } from '@/components/mail/composeDraft'
import { isTypingTarget, shortcutBlocked, shortcutFor } from '@/components/mail/shortcuts'
import type { Selection } from '@/components/mail/selection'
import type { MessageListItem } from '../../../main/mailclient/core/types'
import type { MoveTarget } from './useMessageActions'

/** R4: the mail page's keyboard shortcuts, one window keydown handler */
export function useMailShortcuts({
  searchRef,
  folderTreeRef,
  compose,
  selection,
  selectedId,
  canWrite,
  markRead,
  trashable,
  moveAway,
  startCompose,
  composeFromList
}: {
  searchRef: RefObject<HTMLInputElement | null>
  folderTreeRef: RefObject<HTMLUListElement | null>
  compose: object | null
  selection: Selection
  selectedId: number | null
  canWrite: boolean
  markRead: (ids: number[], read: boolean) => void
  trashable: MessageListItem[]
  moveAway: (ids: number[], target: MoveTarget) => Promise<void>
  startCompose: (state: ComposeState) => void
  composeFromList: (id: number, kind: 'reply' | 'replyAll' | 'forward') => void
}) {
  // "/" focuses the search, as in most mail clients; B3 adds the action shortcuts.
  // Declared after every handler it calls, so the effect never closes over a value
  // that is declared later.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === '/' && !target?.closest('input, textarea, [contenteditable]')) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      // A shortcut never steals a keystroke while the user is typing, and MR-37: not from a dialog,
      // a popover, a menu or the compose area either - the handler is on window, so those reached
      // the list and moved mail or replaced the open editor
      if (isTypingTarget(target)) return
      if (shortcutBlocked({ target, composeOpen: compose !== null })) return
      const ids = selection.ids
      const action = shortcutFor(event, {
        hasSelection: ids.length > 0,
        canWrite,
        hasReader: selectedId !== null
      })
      if (!action) return
      event.preventDefault()
      switch (action) {
        case 'markUnread':
          markRead(ids, false)
          break
        case 'markRead':
          markRead(ids, true)
          break
        case 'toTrash':
          if (trashable.length)
            void moveAway(
              trashable.map((m) => m.id),
              { kind: 'delete' }
            )
          break
        case 'move':
          // There is no folder-picker dialog: moving is drag and drop. The shortcut
          // puts the keyboard on the folder tree, where the drop targets are.
          folderTreeRef.current?.focus()
          break
        case 'compose':
          startCompose(emptyCompose())
          break
        case 'reply':
          if (selectedId !== null) composeFromList(selectedId, 'reply')
          break
        case 'replyAll':
          if (selectedId !== null) composeFromList(selectedId, 'replyAll')
          break
        case 'forward':
          if (selectedId !== null) composeFromList(selectedId, 'forward')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
