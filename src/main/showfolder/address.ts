// ========================================
// An address as files write it
// ========================================
// "Musterweg 11, 12345 Musterstadt", "Musterweg 11 // 12345 Musterstadt, Germany",
// "D-12345 Musterstadt", "Musterweg 11 12345 Musterstadt" → street, number, zip, town, country.
// German addresses are the rule: a five-digit zip without a country means Germany. A four-digit
// zip says nothing on its own (Austria, Switzerland, …): only a prefix ("A-1010", "CH-8001") or a
// country name decides. Pure: no Electron, no database (tests/show_address.test.ts).

import { splitStreet } from '../einvoice/readParty'
import { cleanText, countryByCode, findCountry } from '../import/normalize'

export interface AddressFact {
  street: string
  streetNumber: string
  zipCode: string
  city: string
  /** ISO code ("DE"), '' when the address does not tell */
  countryCode: string
}

const PREFIXES: Record<string, string> = {
  D: 'DE',
  DE: 'DE',
  A: 'AT',
  AT: 'AT',
  CH: 'CH',
  NL: 'NL',
  B: 'BE',
  L: 'LU',
  F: 'FR',
  I: 'IT',
  DK: 'DK',
  PL: 'PL',
  CZ: 'CZ'
}

/**
 * Words a PDF tore apart in an address: "S choenstr." → "Schoenstr.", "Ka iserslautern" →
 * "Kaiserslautern", "Saarbr ü cken" → "Saarbrücken", "Musterstad t" → "Musterstadt". Short
 * words of their own ("Am", "An der") stay.
 */
export function mendAddressWords(value: string): string {
  return (
    cleanText(value)
      // "Summer - Breeze - Weg 1"
      .replace(/(\p{L})\s+-\s+(?=\p{L})/gu, '$1-')
      .replace(/(\p{L}) ([äöüß]) (?=\p{Ll})/gu, '$1$2')
      .replace(/(\p{L}) ([äöüß])(?=\p{Ll})/gu, '$1$2')
      .replace(/(\p{L}{2,}) (\p{Ll})(?=[\s,.]|$)/gu, '$1$2')
      .replace(
        /(^|\s)(\p{Lu}\p{Ll}?) (\p{Ll}{2,})/gu,
        (match, lead: string, head: string, tail: string) =>
          /^(am|an|im|in|zu|um|ab|auf|de|la|le|el|of|on|at)$/i.test(head)
            ? match
            : `${lead}${head}${tail}`
      )
  )
}

/** "D-12345 Musterstadt", "12345 Musterstadt" */
const ZIP_CITY = /^(?:([A-Z]{1,2})\s?-\s?)?(\d{4,5})\s+([\p{L}][\p{L}\d .()'/-]*)$/u

/** A street with its number at the end ("Am Beispielsee 3a", "Musterstr. 11-13") */
const STREET = /^[\p{L}][\p{L}\d .'’/-]*?\s\d+\s?[a-zA-Z]?(?:\s?[-/]\s?\d+\s?[a-zA-Z]?)?$/u

/**
 * A value a form left open: "tba", "tbc", "bitte nachtragen", "----", "n/a". Compared without
 * spaces, since PDFs tear these apart too ("bi tte nachtrag en").
 */
export function isPlaceholder(value: string): boolean {
  const tight = value
    .toLowerCase()
    .replace(/[\s().:/_!*-]+/g, '')
    .replace(/ä/g, 'ae')
  return (
    tight === '' ||
    /^(tba|tbc|tbd|tbanochoffen|nn|na|offen|folgt|folgtnoch|bittenachtragen|bitteeintragen|bitteergaenzen|none|keine|kein|x|\?+)$/.test(
      tight
    ) ||
    // "siehe Venue Specs", "see below"
    /^(siehe|see|vgl)\b/i.test(value.trim())
  )
}

/** A country written out ("Deutschland", "Germany", "Österreich"); codes alone are too short */
export function countryCodeOfName(value: string): string {
  const name = cleanText(value).replace(/[.]$/, '')
  if (name.length < 4) return ''
  return findCountry(name)?.code ?? ''
}

/** The English name stored beside the code ("DE" → "Germany") */
export function countryNameOf(code: string): string {
  return countryByCode(code)?.name ?? ''
}

/** The country for a suggestion, in German ("DE" → "Deutschland") */
export function countryLabelOf(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  try {
    return new Intl.DisplayNames(['de'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** The country of a zip: five digits are German unless the address says otherwise */
export function countryOfZip(zipCode: string, prefix = ''): string {
  if (prefix && PREFIXES[prefix.toUpperCase()]) return PREFIXES[prefix.toUpperCase()]
  return /^\d{5}$/.test(zipCode) ? 'DE' : ''
}

/** "12345 Musterstadt" or "D-12345 Musterstadt" → zip, town, country; null when it is none */
export function zipCityOf(value: string): {
  zipCode: string
  city: string
  countryCode: string
} | null {
  const text = cleanText(value)
    .replace(/(\d)\s+(?=\d)/g, '$1')
    .replace(/[.,;]+$/, '')
  // "7511 PG Musterstad": a Dutch zip
  const dutch = /^(?:NL\s?-\s?)?(\d{4})\s?([A-Z]{2})\s+([\p{L}][\p{L} .'-]*)$/u.exec(text)
  if (dutch)
    return {
      zipCode: `${dutch[1]} ${dutch[2]}`,
      city: mendAddressWords(dutch[3]),
      countryCode: 'NL'
    }
  const match = ZIP_CITY.exec(text)
  if (!match) return null
  // the town ends where a sentence starts ("Musterstadt. Zufahrt ist ausgeschildert."); PDFs
  // space hyphens ("Musterdorf - Ortsteil") and tear the last letter off ("Musterstad t")
  const city = cleanText(match[3].split(/\.\s/)[0].replace(/\s*\(.*\)\s*$/, '')).replace(
    /\s+-\s+/g,
    '-'
  )
  const mended = mendAddressWords(city)
  if (!mended || /^\d/.test(mended)) return null
  return { zipCode: match[2], city: mended, countryCode: countryOfZip(match[2], match[1] ?? '') }
}

/** True when a line is a street with a house number */
export const isStreetLine = (value: string): boolean => STREET.test(cleanText(value))

/**
 * An address from one line or several: the parts are split at commas, "//", " | " and line
 * breaks; the street is the part with a house number, the zip and town the part that starts with
 * a zip, the country a part that names one. A street and a zip without anything between them
 * ("Musterweg 11 12345 Musterstadt") are split too. Empty fields when a part is missing.
 */
export function parseAddress(value: string): AddressFact {
  const out: AddressFact = { street: '', streetNumber: '', zipCode: '', city: '', countryCode: '' }
  const parts = value
    // "Musterweg 5 in 12345 Musterstadt"
    .replace(/\s+in\s+(?=(?:[A-Z]{1,2}-)?\d{4,5}\s)/g, ', ')
    .split(/\r?\n|\s*\/\/\s*|\s+\|\s+|\s+\.\s+|,/)
    .map((part) => cleanText(part.replace(/\([^)]*\)/g, ' ')))
    .filter(Boolean)
  let country = ''
  const rest: string[] = []
  for (const part of parts) {
    // "Musterweg 11 12345 Musterstadt": street and town on one line
    const joined = /^(.*?\d+\s?[a-zA-Z]?)\s+((?:[A-Z]{1,2}-)?\d{5}\s+\p{L}.*)$/u.exec(part)
    if (joined && isStreetLine(joined[1])) {
      rest.push(joined[1], joined[2])
      continue
    }
    const named = countryCodeOfName(part)
    if (named && !/\d/.test(part)) {
      country ||= named
      continue
    }
    rest.push(part)
  }
  for (const part of rest) {
    const place = !out.zipCode ? zipCityOf(part) : null
    if (place) {
      out.zipCode = place.zipCode
      out.city = place.city
      out.countryCode = place.countryCode
      continue
    }
    if (!out.street && isStreetLine(part)) {
      const { street, streetNumber } = splitStreet(mendAddressWords(part))
      out.street = street
      out.streetNumber = streetNumber
    }
  }
  // a street without a number ("Am Königshügel") when nothing else is one
  if (!out.street) {
    const first = rest.find((part) => !zipCityOf(part) && /^[\p{L}]/u.test(part))
    if (first && first.length <= 60) out.street = first
  }
  if (country) out.countryCode = country
  return out
}
