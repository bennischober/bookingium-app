// The one timestamp format in the database (#153): UTC "YYYY-MM-DD HH:MM:SS", what SQLite's
// datetime('now') writes. It sorts as text and compares with the column defaults.

/** `date` as a database timestamp */
export function sqlTimestamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Milliseconds of a database timestamp, NaN when unreadable. A time without a zone is UTC,
 * unlike Date.parse, which reads "YYYY-MM-DD HH:MM:SS" as local time
 */
export function parseSqlTimestamp(value: string): number {
  const utc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)
  return Date.parse(utc ? `${value.replace(' ', 'T')}Z` : value)
}
