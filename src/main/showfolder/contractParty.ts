// The promoter's side of a show contract (Gastspiel-/Konzertvertrag): the company that books the
// show, its address, VAT id, phone and e-mail, and the person who signs or handles it. Contracts
// name it either in the party block ("zwischen <Firma> … – nachfolgend „Veranstalter“ –") or
// under a label ("Veranstalter: …", "Promoter: …"). Pure: no Electron, no database
// (tests/contract_party.test.ts).

import { cleanText } from '../import/normalize'
import { emailOf, keyOf, segmentsOf } from './extract'

export interface ContractPartyFact {
  name: string
  street: string
  zipCode: string
  city: string
  email: string
  phone: string
  vatId: string
  /** The person who represents or handles it ("vertreten durch", "Ansprechpartner") */
  contactName: string
  contactRole: string
  /** Künstlersozialkasse number and tax number, as a German contract form asks for them */
  kskNumber: string
  taxNumber: string
}

const PHONE = /(?:\+|\b0)\d[\d ./()-]{5,}\d/
const VAT = /\b(?:DE|AT|CH[EU]?|NL|BE|FR|LU|IT|ES|PL|CZ|DK)[\s-]?[0-9A-Z]{8,12}\b/

/** The promoter's role words; the act's side ("Künstler", "Agentur") is never the promoter */
const PROMOTER =
  /veranstalter|vertragspartner|auftraggeber|promoter|organi[sz]er|lopro|local promoter/
const ARTIST_SIDE = /kuenstler|artist|agentur|agency|band|management|kuenstleragentur|kapelle/

/** Lines that end a party block: the other party, the contract's first clause */
const BLOCK_END =
  /^(und|and|sowie|zwischen|between|§|\d+\.|praeambel|preamble|vertragsgegenstand)\b/

/** "Musterweg 11", "Am Beispielsee 3a" */
const STREET = /^[\p{L}][\p{L} .'-]*\s\d+\s?[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?$/iu
const ZIP_CITY = /\b(?:[A-Z]{1,2}-)?(\d{4,5})\s+([\p{L}][\p{L} .-]+)$/u

const labelOf = (segment: string): [string, string] | null => {
  const match = /^([^:]{1,40}):\s*(.*)$/.exec(segment)
  return match ? [keyOf(match[1]), cleanText(match[2])] : null
}

/** "Erika Muster", "Herrn Max Beispiel" → the name; null when the text is no person's name */
function personName(value: string): string {
  const words = cleanText(value.replace(/^(herrn?|frau|mr\.?|mrs\.?|ms\.?)\s+/i, ''))
    .replace(/[,;(].*$/, '')
    .trim()
    .split(' ')
  const name = words.filter((word) => /^[\p{Lu}][\p{L}'.-]*$/u.test(word))
  return name.length >= 2 && name.length <= 4 && name.length === words.length ? name.join(' ') : ''
}

const isCompanyLine = (segment: string): boolean =>
  /\b(gmbh|ug|ag|kg|ohg|gbr|e\.?\s?v\.?|ltd|inc|llc|mbh|co\.|e\.k\.|events?|konzerte?|concerts?|kultur|festival|veranstaltungs)\b/i.test(
    segment
  )

/** Reads the facts of a party block (its lines after the name) into `fact` */
function readBlock(fact: ContractPartyFact, lines: string[], links: readonly string[]): void {
  for (const line of lines) {
    const pair = labelOf(line)
    const label = pair?.[0] ?? ''
    const value = pair?.[1] ?? line
    if (
      /vertreten durch|represented by|gesch(ae|ä)ftsf(ue|ü)hr|inhaber|ansprechpartner|contact|kontakt/.test(
        keyOf(line)
      )
    ) {
      const role = /ansprechpartner|contact|kontakt/.test(keyOf(line))
        ? 'Ansprechpartner'
        : /gesch/.test(keyOf(line))
          ? 'Geschäftsführung'
          : 'Vertretung'
      const raw = pair
        ? value
        : line.replace(/^.*?(vertreten durch|represented by)\s*(den |die |the )?/i, '')
      const name = personName(raw.replace(/\b(geschaeftsfuehrer|geschäftsführer|inhaber)\b/gi, ''))
      if (name && !fact.contactName) {
        fact.contactName = name
        fact.contactRole = role
      }
    }
    const email = emailOf(line, links)
    if (email && !fact.email) fact.email = email
    if (/tel|phone|fon|mobil|handy/.test(label) || (!pair && PHONE.test(line) && !email)) {
      const phone = PHONE.exec(line.replace(/[a-z0-9._%+-]+@\S+/gi, ' '))?.[0]
      if (phone && !fact.phone) fact.phone = cleanText(phone)
    }
    const vat = /ust|vat|steuer/.test(label) || /ust-?id|vat/i.test(line) ? VAT.exec(line) : null
    if (vat && !fact.vatId) fact.vatId = vat[0].replace(/[\s-]/g, '')
    // long labels ("Künstlersozialkassen-Nummer des örtlichen Veranstalters: …") are no pair
    const head = pair ? label : keyOf(line.split(':')[0])
    const tail = pair ? value : line.includes(':') ? line.slice(line.lastIndexOf(':') + 1) : ''
    if (/kuenstlersozialkass|\bksk\b/.test(head) && !fact.kskNumber) {
      const number = /[0-9][0-9A-Z]{5,}/.exec(tail.replace(/\s/g, ''))
      if (number) fact.kskNumber = number[0]
    }
    if (/steuernummer|steuer nr/.test(head) && !vat && !fact.taxNumber) {
      const number = /\d[\d/ ]{5,}\d/.exec(tail)
      if (number) fact.taxNumber = number[0].replace(/\s/g, '')
    }
    if (!pair && !fact.zipCode) {
      const place = ZIP_CITY.exec(line)
      if (place) {
        fact.zipCode = place[1]
        fact.city = cleanText(place[2])
        continue
      }
    }
    if (!pair && !fact.street && STREET.test(line) && !PHONE.test(line)) fact.street = line
    if (pair && /strasse|anschrift|adresse|address|street/.test(label) && !fact.street)
      fact.street = value
    if (pair && /^(plz|ort|stadt|city|zip)/.test(label) && !fact.zipCode) {
      const place = ZIP_CITY.exec(value)
      if (place) {
        fact.zipCode = place[1]
        fact.city = cleanText(place[2])
      }
    }
  }
}

const empty = (): ContractPartyFact => ({
  name: '',
  street: '',
  zipCode: '',
  city: '',
  email: '',
  phone: '',
  vatId: '',
  contactName: '',
  contactRole: '',
  kskNumber: '',
  taxNumber: ''
})

/**
 * The promoter of a contract; null when the text names none. The labelled form wins over the
 * party block, the block is read up to the next party or the first clause.
 */
export function extractContractParty(
  text: string,
  links: readonly string[] = []
): ContractPartyFact | null {
  const segments = segmentsOf(text).filter(Boolean)

  // 1. "Veranstalter: Muster Events GmbH" and the lines below it
  for (let index = 0; index < segments.length; index++) {
    const pair = labelOf(segments[index])
    if (!pair) continue
    const [rawLabel, value] = pair
    // "und dem örtlichen Veranstalter: …" (a party line of the contract's head)
    const label = rawLabel
      .replace(/^(und|and|sowie)\s+/, '')
      .replace(/^(dem|der|den|die|the)\s+/, '')
      .replace(/^(oertlichen|lokalen|local)\s+/, '')
    if (!PROMOTER.test(label) || ARTIST_SIDE.test(label) || label.split(' ').length > 3) continue
    const lines: string[] = []
    let name = value
    // the whole party on one line: "Stadt Musterstadt, Kulturamt, Musterweg 1, 12345 Musterstadt"
    if (name.includes(',')) {
      const parts = name.split(/\s*,\s*/).filter(Boolean)
      name = parts[0]
      lines.push(...parts.slice(1))
    }
    let next = index + 1
    if (!name && next < segments.length) name = segments[next++]
    for (; next < segments.length && lines.length < 7; next++) {
      const line = segments[next]
      const nextPair = labelOf(line)
      if (BLOCK_END.test(keyOf(line))) break
      // "Künstlersozialkassen-Nummer des örtlichen Veranstalters: …" belongs to the party
      if (nextPair && /kuenstlersozialkass|\bksk\b|steuer|ust|vat/.test(nextPair[0])) {
        lines.push(line)
        continue
      }
      if (nextPair && (PROMOTER.test(nextPair[0]) || ARTIST_SIDE.test(nextPair[0]))) break
      lines.push(line)
    }
    if (!name || name.length > 120) continue
    const fact = { ...empty(), name: cleanText(name) }
    readBlock(fact, lines, links)
    return fact
  }

  // 2. the party block: "zwischen" … lines … "(nachfolgend „Veranstalter“ genannt)"
  for (let index = 0; index < segments.length; index++) {
    const key = keyOf(segments[index])
    if (
      !/(nachfolgend|im folgenden|hereinafter|hiernach|kurz)\b.*\b(veranstalter|promoter|organi[sz]er|auftraggeber)/.test(
        key
      ) &&
      !/^\(?\s*(veranstalter|promoter)\s*\)?$/.test(key)
    )
      continue
    // the lines above, back to "zwischen"/"und" or at most eight
    const lines: string[] = []
    for (let back = index - 1; back >= 0 && lines.length < 8; back--) {
      const line = segments[back]
      const lineKey = keyOf(line)
      if (/^(zwischen|between|und|and)$/.test(lineKey)) break
      if (/nachfolgend|hereinafter|im folgenden/.test(lineKey)) break
      lines.unshift(line.replace(/^(zwischen|between)\s+(der |dem |the )?(firma\s+)?/i, ''))
      if (/^(zwischen|between)\b/i.test(line)) break
    }
    // the name sits on the same line as the "nachfolgend" phrase or opens the block
    const own = segments[index].split(/[-–(,]\s*(nachfolgend|im folgenden|hereinafter)/i)[0].trim()
    const nameIndex = lines.findIndex(isCompanyLine)
    const name =
      own && !/^(nachfolgend|im folgenden|hereinafter|\()/i.test(own)
        ? own
        : nameIndex >= 0
          ? lines[nameIndex]
          : (lines[0] ?? '')
    if (!name) continue
    const fact = { ...empty(), name: cleanText(name.replace(/^(der |die |the )?(firma\s+)?/i, '')) }
    readBlock(
      fact,
      lines.filter((line) => line !== name),
      links
    )
    return fact
  }
  return null
}

export interface ContractEventFact {
  /** ISO date, '' when not found */
  date: string
  /** The event as the contract names it ("Festival der kommunalen Jugendarbeit") */
  eventName: string
  zipCode: string
  city: string
  /** The location within the place ("Jahnstadion") */
  location: string
}

const DATE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/

/**
 * The show a contract is about, from a form whose labels stand in one column and the values in
 * the next ("Veranstaltungsdatum:", "Event/Veranstaltung:", "Veranstaltungsort:", "Location:"
 * and below them the values in that order), or from labels with their value on the same line.
 */
export function extractContractEvent(text: string): ContractEventFact | null {
  const segments = segmentsOf(text).filter(Boolean)
  const fact: ContractEventFact = { date: '', eventName: '', zipCode: '', city: '', location: '' }
  const assign = (label: string, value: string) => {
    const key = keyOf(label)
    if (!value) return
    if (/datum|date/.test(key) && !fact.date) {
      const match = DATE.exec(value)
      if (match) fact.date = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
    } else if (/^(event|veranstaltung|event veranstaltung|veranstaltungsname)$/.test(key))
      fact.eventName ||= value
    else if (/^(veranstaltungsort|ort|place|city)$/.test(key) && !fact.zipCode) {
      const place = ZIP_CITY.exec(value)
      if (place) {
        fact.zipCode = place[1]
        fact.city = cleanText(place[2])
      } else fact.city ||= value
    } else if (/^(location|spielstaette|halle|venue)$/.test(key)) fact.location ||= value
  }
  for (let index = 0; index < segments.length; index++) {
    // a column of labels without values, then the values in the same order
    const labels: string[] = []
    let next = index
    while (next < segments.length) {
      const pair = labelOf(segments[next])
      if (!pair || pair[1]) break
      labels.push(segments[next].replace(/:\s*$/, ''))
      next++
    }
    if (labels.length >= 3) {
      for (let i = 0; i < labels.length && next + i < segments.length; i++) {
        if (labelOf(segments[next + i])) break
        assign(labels[i], cleanText(segments[next + i]))
      }
      index = next
      continue
    }
    const pair = labelOf(segments[index])
    if (pair && pair[1]) assign(segments[index].split(':')[0], pair[1])
  }
  return fact.date || fact.eventName || fact.city ? fact : null
}
