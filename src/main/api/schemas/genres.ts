// Genre tags of venues, bands and media companies (the Verteiler's genre
// filter). Free text, comma-separated in the API, trimmed and deduplicated
// (case-insensitive) as "Metal, Rock"; stored as genre rows (#152,
// repositories/genres.ts)
export function splitGenres(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of value.split(/[,;]/)) {
    const tag = raw.trim()
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      tags.push(tag)
    }
  }
  return tags
}

/** " Rock;metal " -> "Rock, metal" (the API form) */
export const normalizeGenres = (value: string): string => splitGenres(value).join(', ')
