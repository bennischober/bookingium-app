/**
 * G2/L1: mails the user just moved away, hidden before the server has answered.
 *
 * The list removes a mail the moment the user clicks delete/move, so the next mail is
 * immediately selectable and a quick run through Spam or Drafts is as fast as the clicks.
 * The server's answer arrives later; when it is a failure, the ids come back so the mail
 * reappears instead of silently vanishing.
 *
 * Kept as a pure module because this is the part that can be wrong in a way nobody notices
 * until a mail is lost from the list: the set must never grow unboundedly, and a re-hide
 * must not duplicate an id.
 */

/** Add ids to the hidden set, without duplicates and without reordering what is there */
export function hide(hidden: readonly number[], ids: readonly number[]): number[] {
  const next = [...hidden]
  for (const id of ids) if (!next.includes(id)) next.push(id)
  return next
}

/** Drop ids from the hidden set - a failed move puts exactly those rows back */
export function unhide(hidden: readonly number[], ids: readonly number[]): number[] {
  return hidden.filter((id) => !ids.includes(id))
}

/** The rows to show: everything except the hidden ones, in the list's own order */
export function visible<T extends { id: number }>(
  items: readonly T[],
  hidden: readonly number[]
): T[] {
  if (hidden.length === 0) return items as T[]
  return items.filter((item) => !hidden.includes(item.id))
}
