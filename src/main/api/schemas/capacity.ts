// #245: a venue's capacity is a number or a range ("500–1000", depending on seating or room).
// `capacity` stays the upper (or only) value, so everything that compares one number keeps
// working; `capacityMin` is the lower end of a range, null for a single number.

export type CapacityRange = { min: number | null; max: number | null }

const NUMBER = /\d[\d.\s]*\d|\d/g

function toNumber(text: string): number | null {
  const value = Number(text.replace(/[.\s]/g, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * "1200" → 1200; "500-1000", "500 – 1.000", "500 bis 1000" → 500 to 1000; "bis 800" → 800.
 * Two equal numbers are one; reversed ones are put in order. null/null for no number.
 */
export function parseCapacityRange(raw: string): CapacityRange {
  const numbers = (raw.match(NUMBER) ?? []).map(toNumber).filter((n): n is number => n !== null)
  if (numbers.length === 0) return { min: null, max: null }
  if (numbers.length === 1) return { min: null, max: numbers[0] }
  const [a, b] = numbers
  if (a === b) return { min: null, max: a }
  return { min: Math.min(a, b), max: Math.max(a, b) }
}

/** "1.200", "500–1.000" or '' */
export function formatCapacity(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  if (max == null) return ''
  const de = (n: number): string => n.toLocaleString('de-DE')
  return min != null && min < max ? `${de(min)}–${de(max)}` : de(max)
}

/** The text a form shows for a stored capacity: "1200" or "500-1000" */
export function capacityInputText(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  if (max == null) return ''
  return min != null && min < max ? `${min}-${max}` : String(max)
}

/** Whether a typed text is a valid capacity: empty, one number or a range */
export function capacityError(raw: string): string | undefined {
  if (!raw.trim()) return undefined
  if (/[^\d.\s\-–—bisBIS]/.test(raw))
    return 'Eine Zahl oder eine Spanne eintragen, z. B. 1200 oder 500-1000'
  return parseCapacityRange(raw).max === null ? 'Kapazität muss eine positive Zahl sein' : undefined
}
