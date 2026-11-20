// Numbers as English words for contract wording ("three (3) years"), the English
// counterpart of germanNumbers.ts

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen'
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** 0-99 as an English word ("twenty-one"); other numbers as digits */
export function englishNumberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n)
  if (n < 20) return ONES[n]
  const ones = n % 10
  return ones === 0 ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]}-${ONES[ones]}`
}

/** "thirty (30)" */
export function englishNumberWithWord(n: number): string {
  return `${englishNumberWord(n)} (${n})`
}

/** "one (1) year" / "three (3) years" */
export function englishQuantity(n: number, singular: string, plural: string): string {
  return `${englishNumberWithWord(n)} ${n === 1 ? singular : plural}`
}
