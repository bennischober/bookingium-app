// Class names the detail page tabs share (TabHeader is in DetailParts)

/** Card lists in a tab (members, memberships) use the width like the tables do */
export const CARD_GRID = 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'

/** An empty tab's trigger is dimmed, so it reads as empty before it is opened */
export function emptyTabClass(count: number | undefined): string | undefined {
  return count === 0 ? 'data-[state=inactive]:opacity-60' : undefined
}
