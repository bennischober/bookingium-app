// ========================================
// Row ids that are unique across computers
// ========================================
// Without sync every table counts its ids up from 1 (AUTOINCREMENT). Two computers creating rows
// independently would hand out the same ids, so while sync is on each computer takes ids from its
// own range: prefix * 2^33 + n. The prefix is random per computer (checked against the others'
// when it joins), n counts up. The schema's id columns call nextRowId() as their default; while
// sync is off it returns null and SQLite counts as before.
//
// No imports on purpose: schema.ts uses this module.

/** Ids per computer: 2^33 (8.6 billion) */
export const ID_RANGE = 2 ** 33
/** Prefixes are 1..MAX_PREFIX, so every id stays a safe integer (< 2^53) */
export const MAX_PREFIX = 2 ** 20 - 1

type Generator = { prefix: number; next: number }
let generator: Generator | null = null

/** Default of every integer id column: the next id of this computer's range, null without sync */
export function nextRowId(): number {
  // null makes SQLite assign the id; drizzle passes the value through as a parameter
  if (!generator) return null as unknown as number
  const id = generator.prefix * ID_RANGE + generator.next
  generator.next += 1
  if (generator.next >= ID_RANGE) throw new Error('Der ID-Bereich dieses Computers ist erschöpft.')
  return id
}

/**
 * Switches the generator on with this computer's prefix, continuing after `highest` (the largest
 * id of the range already used, 0 for none). null switches it off.
 */
export function configureRowIds(config: { prefix: number; highest: number } | null): void {
  if (!config) {
    generator = null
    return
  }
  if (!Number.isInteger(config.prefix) || config.prefix < 1 || config.prefix > MAX_PREFIX)
    throw new Error(`Invalid id prefix ${config.prefix}`)
  const base = config.prefix * ID_RANGE
  const used = config.highest >= base ? config.highest - base : 0
  generator = { prefix: config.prefix, next: Math.max(1, used + 1) }
}

export function rowIdsActive(): boolean {
  return generator !== null
}

/** The first and last id of a prefix's range */
export function idRange(prefix: number): { first: number; last: number } {
  return { first: prefix * ID_RANGE, last: prefix * ID_RANGE + ID_RANGE - 1 }
}

/** A random prefix that none of `taken` uses */
export function randomPrefix(taken: Iterable<number>, random: () => number = Math.random): number {
  const used = new Set(taken)
  for (let attempt = 0; attempt < 1000; attempt++) {
    const prefix = 1 + Math.floor(random() * MAX_PREFIX)
    if (!used.has(prefix)) return prefix
  }
  throw new Error('No free id prefix found')
}
