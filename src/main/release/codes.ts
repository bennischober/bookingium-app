// ========================================
// Codes and durations of a label copy (#289)
// ========================================
// Pure helpers, also imported by the renderer. They only warn: a label copy is kept as it
// came, a code that fails the check is still saved.

/** Upper case without spaces and dashes: "de-1k1-24-10201" -> "DE1K12410201" */
export function normalizeCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

/** ISRC: country (2 letters), registrant (3 letters/digits), year (2 digits), number (5 digits) */
export function isValidIsrc(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalizeCode(value))
}

/** UPC-A (12 digits) or EAN-13 (13 digits) with a correct check digit */
export function isValidGtin(value: string): boolean {
  const digits = normalizeCode(value)
  if (!/^\d{12,13}$/.test(digits)) return false
  const body = digits.slice(0, -1)
  let sum = 0
  // weights 3 and 1 alternate from the right of the body
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i])
    sum += i % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1])
}

/** 202 -> "3:22", 3725 -> "1:02:05"; null -> "" */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return ''
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * "3:22" -> 202, "1:02:05" -> 3725, "202" -> 202 (plain seconds); "" -> null.
 * Returns undefined when the text is no duration.
 */
export function parseDuration(text: string): number | null | undefined {
  const value = text.trim()
  if (!value) return null
  if (/^\d+$/.test(value)) return Number(value)
  const parts = value.split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return undefined
  const numbers = parts.map(Number)
  if (numbers.slice(1).some((n) => n >= 60)) return undefined
  return numbers.reduce((total, n) => total * 60 + n, 0)
}

/** Sum of the shares per role, for the "should be 100 %" hint; roles without shares are left out */
export function shareTotals(
  shares: ReadonlyArray<{ role: string; sharePercent: number | null }>
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const share of shares) {
    if (share.sharePercent === null) continue
    totals.set(share.role, (totals.get(share.role) ?? 0) + share.sharePercent)
  }
  return totals
}
