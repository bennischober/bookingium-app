// The search field of "E-Mail-Regeln": which rules match what was typed. Every word has to
// appear in the rule's name or in what it does (its summary line), in any case.

const words = (query: string): string[] =>
  query.toLocaleLowerCase('de-DE').split(/\s+/).filter(Boolean)

/** The rules matching the query, in their order; all of them for an empty query */
export function filterRules<T extends { name: string }>(
  rules: readonly T[],
  query: string,
  summaryOf: (rule: T) => string
): T[] {
  const wanted = words(query)
  if (wanted.length === 0) return [...rules]
  return rules.filter((rule) => {
    const text = `${rule.name} ${summaryOf(rule)}`.toLocaleLowerCase('de-DE')
    return wanted.every((word) => text.includes(word))
  })
}
