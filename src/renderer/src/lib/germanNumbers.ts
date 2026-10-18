// Numbers as German words for contract wording ("drei (3) Jahren")

const ONES = [
  'null',
  'eins',
  'zwei',
  'drei',
  'vier',
  'fünf',
  'sechs',
  'sieben',
  'acht',
  'neun',
  'zehn',
  'elf',
  'zwölf',
  'dreizehn',
  'vierzehn',
  'fünfzehn',
  'sechzehn',
  'siebzehn',
  'achtzehn',
  'neunzehn'
]
const TENS = [
  '',
  '',
  'zwanzig',
  'dreißig',
  'vierzig',
  'fünfzig',
  'sechzig',
  'siebzig',
  'achtzig',
  'neunzig'
]

/** 0-99 as a German word ("einundzwanzig"); other numbers as digits */
export function germanNumberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n)
  if (n < 20) return ONES[n]
  const ones = n % 10
  const tens = TENS[Math.floor(n / 10)]
  return ones === 0 ? tens : `${ones === 1 ? 'ein' : ONES[ones]}und${tens}`
}

/**
 * "drei (3) Jahren" style quantity. `one` is the phrase for exactly one
 * (its article form depends on the sentence, e.g. "einem (1) Jahr"),
 * `many` the unit for all other counts.
 */
export function germanQuantity(n: number, one: string, many: string): string {
  return n === 1 ? one : `${germanNumberWord(n)} (${n}) ${many}`
}
