/**
 * Merging the two address sources for the compose recipient field.
 *
 * The mail core is dependency-free and cannot see the app database, so the mail store only knows
 * addresses it has seen in message headers. That leaves out every person, company and venue contact
 * you have on file but never mailed - exactly the case the lookup is for ("I know the name, not the
 * address"). The host merges both sources and hands the dropdown one list.
 *
 * Kept pure and outside the mail core: the ranking and the name matching are the parts that can be
 * wrong in ways nobody notices until a recipient is missing from the dropdown.
 */

/** Where a suggestion came from; the dropdown labels it so the user knows why it is there */
export type RecipientSource = 'person' | 'company' | 'venue' | 'mail'

export type RecipientCandidate = {
  name: string
  email: string
  source: RecipientSource
}

/** Lower-case, accents folded: "Schöber" and "Schober" must match each other */
export function fold(value: string): string {
  return (
    value
      .normalize('NFD')
      // strip the combining marks NFD split off (ö -> o + combining diaeresis)
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  )
}

/** An address is only usable when it actually looks like one */
export function isUsableAddress(email: string): boolean {
  const value = email.trim()
  if (!value) return false
  // one @, something on both sides, a dot in the domain
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
}

/**
 * Does this candidate answer the query?
 *
 * Name and address are both searched, and every token must appear in at least one of them - so
 * "benjamin schober", "schober benjamin" and "schober" all find "Benjamin Schober", while a query
 * with a token that matches nothing does not produce a hit.
 */
export function matchesQuery(candidate: RecipientCandidate, query: string): boolean {
  const tokens = fold(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  const haystack = `${fold(candidate.name)} ${fold(candidate.email)}`
  return tokens.every((token) => haystack.includes(token))
}

/** Rank: an app record beats a name only seen in mail, and a name match beats a body match */
function rank(candidate: RecipientCandidate, query: string): number {
  const sourceRank: Record<RecipientSource, number> = {
    person: 0,
    company: 1,
    venue: 2,
    mail: 3
  }
  const name = fold(candidate.name)
  const email = fold(candidate.email)
  const needle = fold(query)
  // a name that STARTS with the query is the strongest signal ("schob" -> Schober)
  const prefix = name.startsWith(needle) ? 0 : 1
  const inName = name.includes(needle) ? 0 : 1
  const inEmail = email.includes(needle) ? 0 : 1
  return sourceRank[candidate.source] * 100 + prefix * 10 + inName * 5 + inEmail
}

/**
 * One deduplicated, ranked list for the dropdown.
 *
 * The same address can come from several sources (a person, the company they work for, and an old
 * mail). It appears once, under the strongest source - so the label never says "Aus E-Mails" for
 * somebody who is in the address book.
 */
export function mergeRecipients(
  candidates: readonly RecipientCandidate[],
  query: string,
  limit = 8
): RecipientCandidate[] {
  const best = new Map<string, RecipientCandidate>()
  for (const candidate of candidates) {
    const email = candidate.email.trim()
    // a record with no address can never be a recipient
    if (!isUsableAddress(email)) continue
    if (!matchesQuery(candidate, query)) continue
    const key = email.toLowerCase()
    const seen = best.get(key)
    if (!seen || rank(candidate, query) < rank(seen, query)) {
      best.set(key, { ...candidate, email })
    }
  }
  return [...best.values()]
    .sort((a, b) => rank(a, query) - rank(b, query) || a.name.localeCompare(b.name, 'de'))
    .slice(0, limit)
}
