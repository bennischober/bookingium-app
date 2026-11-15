/** What a new person's quick-create dialog opens with */
export type PersonPrefill = { firstName: string; lastName: string; email: string }

/** The combobox's search text as a new person's name: first word, then the rest */
export const personFromSearch = (query: string): PersonPrefill => {
  const parts = query.trim().split(/\s+/)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' '), email: '' }
}
