/**
 * G5/G6: the UIDVALIDITY a locally-stored appended draft must be keyed with.
 *
 * A saved draft is stored locally right after APPEND so it appears at once instead of only after
 * the Drafts folder is resynced. The stored key must be the one the NEXT sync computes, or the sync
 * inserts a second row for the same draft: `message_key` is UNIQUE, but two different keys are two
 * rows. The key is `sha1(account|folderId|uidValidity|uid)`, so the validity has to agree.
 *
 * The caller passes the folder's validity as it knew it when the op was built, which is null until
 * that folder has been synced once. Falling back to the folder row covers the common case where the
 * value arrived meanwhile.
 *
 * Returns null when nothing is known: the local store is then skipped and the resync remains the way
 * the draft appears. That is slower but correct - a duplicate row is not an option, because the user
 * would see the same draft twice and deleting one would leave the other.
 */
export function draftStoreValidity(
  callerValidity: string | null | undefined,
  folderValidity: string | null | undefined
): string | null {
  const validity = callerValidity || folderValidity || ''
  return validity === '' ? null : validity
}
