/**
 * MR-35: which actions the reading pane may offer for a given account.
 *
 * The pane used to be handed `onWriteTo` and `onCompose` unconditionally, so on the read-only
 * account clicking a sender opened an editor. Its autosave failed silently
 * (`.catch(() => undefined)` in ComposeView) and the typed text was lost at the end.
 *
 * The rule is one line - only a writable account may write - but it lives here so both pages share
 * it and vitest can hold it, instead of the same expression being written twice in .tsx.
 */
export type ReadingAccount = { readOnly: boolean } | null | undefined

export type ReadingActions = {
  /** every write action: flag, move, delete, expunge */
  canWrite: boolean
  /** reply, reply-all, forward */
  canCompose: boolean
  /** a new mail to one header address (F2) */
  canWriteTo: boolean
}

/** No account yet (the list is still loading) may do nothing either. */
export function readingActions(account: ReadingAccount): ReadingActions {
  const canWrite = account?.readOnly === false
  return { canWrite, canCompose: canWrite, canWriteTo: canWrite }
}
