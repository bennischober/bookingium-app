// The promoter's side of a show contract (Gastspiel-/Konzertvertrag): the company that books the
// show, its address, VAT id, phone and e-mail, and the person who signs or handles it. Contracts
// name it either in the party block ("zwischen <Firma> … – nachfolgend „Veranstalter“ –") or
// under a label ("Veranstalter: …", "Promoter: …"). Pure: no Electron, no database
// (tests/contract_party.test.ts).

import { cleanText } from '../import/normalize'
import {
  countryCodeOfName,
  isPlaceholder,
  isStreetLine,
  mendAddressWords,
  parseAddress,
  zipCityOf
} from './address'
import { emailOf, joinSpacedDomain, keyOf, mendWords, segmentsOf } from './extract'

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
  /** The promoter's website, as an info sheet names it ("Website: …") */
  website: string
  /** ISO code ("DE"); a five-digit zip without a country is German */
  countryCode: string
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
/** Words of a role, not of a name ("Technical Production", "Tour Manager") */
const ROLE_WORDS =
  /^(technical|technische?r?|production|produktion|booking|manager|management|tour|contact|kontakt|venue|promoter|veranstalter|technik|leitung|ansprechp\.?|ansprechpartner(in)?|team|office|büro|buero|info|hospitality|artist|stage|foh|monitor|licht|ton|konzertbüro|konzertbuero|agentur|agency)$/i

function personName(value: string): string {
  const stripped = value.replace(/^\s*(ansprechp(artner)?(in)?|kontakt|contact)\.?\s*:?\s*/i, '')
  if (stripped.split(/\s+/).some((word) => ROLE_WORDS.test(word)) || isCompanyLine(stripped))
    return ''
  const words = cleanText(stripped.replace(/^(herrn?|frau|mr\.?|mrs\.?|ms\.?)\s+/i, ''))
    .replace(/[,;(].*$/, '')
    .trim()
    .split(' ')
  const name = words.filter((word) => /^[\p{Lu}][\p{L}'.-]*$/u.test(word))
  return name.length >= 2 && name.length <= 4 && name.length === words.length ? name.join(' ') : ''
}

function isCompanyLine(segment: string): boolean {
  return /\b(gmbh|ug|ag|kg|ohg|gbr|e\.?\s?v\.?|ltd|inc|llc|mbh|co\.|e\.k\.|events?|konzerte?|concerts?|kultur|festival|veranstaltungs)\b/i.test(
    segment
  )
}

/** Legal forms that end a company's name ("Muster Events GmbH", "Beispiel e.V.") */
const LEGAL_FORM =
  /^(.*?\b(?:gGmbH|GmbH(?:\s*&\s*Co\.?\s*KG)?|e\.\s?V\.?|GbR|UG(?:\s*\(haftungsbeschränkt\))?|AG|KG|OHG|e\.\s?K\.|Ltd\.?|a\.\s?s\.|s\.r\.o\.|Inc\.?|LLC|mbH))(?=\s|,|;|$)\s*[,.;]?\s*(.*)$/

/**
 * A promoter's name as a contract line writes it, apart from what follows it: "und dem örtlichen
 * Veranstalter; Muster e.V." → "Muster e.V."; "Muster GmbH Musterweg 1 . 12345 Musterstadt" →
 * the name and the address lines behind it. PDFs space hyphens ("Muster - Rock GmbH").
 */
export function splitPartyName(raw: string): { name: string; rest: string[] } {
  let value = cleanText(raw.normalize('NFC'))
  for (let i = 0; i < 3; i++)
    value = value
      .replace(/^(und|and|sowie)(\s+|$)/i, '')
      .replace(/^(dem|der|den|die)(\s+|$)/i, '')
      .replace(/^(örtlichen|oertlichen|lokalen|local)(\s+|$)/i, '')
      .replace(/^(veranstalter|promoter)\s*([;:]\s*|$)/i, '')
  value = value.replace(/(\p{L})\s+-\s+(\p{L})/gu, '$1-$2')
  const legal = LEGAL_FORM.exec(value)
  if (legal && !legal[2]) return { name: mendWords(legal[1]), rest: [] }
  if (legal && legal[2]) {
    const rest = legal[2]
      .replace(/\s+in\s+(?=(?:[A-Z]{1,2}-)?\d{4,5}\s)/g, ', ')
      .split(/\s*[,;]\s*|\s+\.\s+/)
      .map((part) => part.replace(/[\s.]+$/, ''))
      .filter(Boolean)
      .flatMap((part) => {
        // "Musterweg 5 12345 Musterstadt" → the street, then zip and town
        const address = parseAddress(part)
        return address.streetNumber && address.zipCode
          ? [`${address.street} ${address.streetNumber}`, `${address.zipCode} ${address.city}`]
          : [part]
      })
    return { name: mendWords(legal[1]), rest: rest.filter((part) => !part.startsWith('/')) }
  }
  const name = mendWords(value.replace(/[\s.,]+$/, ''))
  if (isStreetLine(name) || /^\d{1,4}\s+\p{L}+$/u.test(name) || isPlaceholder(name))
    return { name: '', rest: [] }
  // "Muster Rock, Erika Muster": the name, then the person
  if (name.includes(',')) {
    const [first, ...rest] = name.split(/\s*,\s*/)
    return { name: first, rest }
  }
  return { name, rest: [] }
}

/** Reads the facts of a party block (its lines after the name) into `fact` */
function readBlock(fact: ContractPartyFact, lines: string[], links: readonly string[]): void {
  for (const line of lines) {
    const pair = labelOf(line)
    // labels without the spaces a PDF puts in ("Adress e", "Firmenn ame")
    const label = (pair?.[0] ?? '').replace(/ /g, '')
    const value = pair?.[1] ?? line
    if (
      /vertreten durch|represented by|gesch(ae|ä)ftsf(ue|ü)hr|inhaber|ansprechp|contact|kontakt/.test(
        keyOf(line)
      )
    ) {
      const role = /ansprechp|contact|kontakt/.test(keyOf(line))
        ? 'Ansprechpartner'
        : /gesch/.test(keyOf(line))
          ? 'Geschäftsführung'
          : 'Vertretung'
      const raw = pair
        ? value
        : line
            .replace(/^.*?(vertreten durch|represented by)\s*(den |die |the )?/i, '')
            .replace(/^\s*(ansprechp(artner)?(in)?|kontakt|contact)\.?\s*/i, '')
      const name = personName(
        mendWords(raw.replace(/\b(geschaeftsfuehrer|geschäftsführer|inhaber)\b/gi, ''))
      )
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
    const vat =
      /ust|vat|steuer/.test(label) || /ust\s*-?\s*id|vat/i.test(line) ? VAT.exec(line) : null
    if (vat && !fact.vatId) fact.vatId = vat[0].replace(/[\s-]/g, '')
    // long labels ("Künstlersozialkassen-Nummer des örtlichen Veranstalters: …") are no pair
    const head = pair ? label : keyOf(line.split(':')[0])
    const tail = pair ? value : line.includes(':') ? line.slice(line.lastIndexOf(':') + 1) : ''
    if (/kuenstlersozialkass|\bksk\b/.test(head) && !fact.kskNumber) {
      const number = /[0-9][0-9A-Z]{5,}/.exec(tail.replace(/\s/g, ''))
      if (number) fact.kskNumber = number[0]
    }
    if (/steuernummer|steuer nr|\bst nr\b/.test(head) && !vat && !fact.taxNumber) {
      const number = /\d[\d/ ]{5,}\d/.exec(tail)
      if (number) fact.taxNumber = number[0].replace(/\s/g, '')
    }
    if (!pair && !fact.countryCode && !/\d/.test(line)) {
      const country = countryCodeOfName(line)
      if (country) {
        fact.countryCode = country
        continue
      }
    }
    if (!pair && !fact.street && !fact.zipCode) {
      const address = parseAddress(line)
      if (address.streetNumber && address.zipCode) {
        fact.street = `${address.street} ${address.streetNumber}`
        fact.zipCode = address.zipCode
        fact.city = address.city
        fact.countryCode ||= address.countryCode
        continue
      }
    }
    if (!pair && !fact.zipCode) {
      const place = ZIP_CITY.exec(line) ?? ZIP_CITY.exec(line.split(',')[0].trim())
      if (place) {
        const parsed = zipCityOf(place[0])
        fact.zipCode = place[1]
        fact.city = cleanText(place[2])
        fact.countryCode ||= parsed?.countryCode ?? ''
        continue
      }
    }
    if (!pair && !fact.street && STREET.test(line) && !PHONE.test(line) && !isPlaceholder(line))
      fact.street = line
    if (
      pair &&
      /strasse|anschrift|adresse|address|street/.test(label) &&
      !/rechnung|billing|invoice/.test(label) &&
      !fact.street
    ) {
      // "Musterweg 11, 12345 Musterstadt" in one value
      const parsed = parseAddress(value)
      fact.street = parsed.street ? `${parsed.street} ${parsed.streetNumber}`.trim() : value
      if (parsed.zipCode && !fact.zipCode) {
        fact.zipCode = parsed.zipCode
        fact.city = parsed.city
      }
      fact.countryCode ||= parsed.countryCode
    }
    if (pair && /^(land|country|staat)$/.test(label) && !fact.countryCode)
      fact.countryCode = /^[A-Z]{2}$/.test(value) ? value : countryCodeOfName(value)
    if (pair && /^(plz|ort|stadt|city|zip)/.test(label) && !fact.zipCode) {
      const place = ZIP_CITY.exec(value)
      if (place) {
        fact.zipCode = place[1]
        fact.city = cleanText(place[2])
      }
    }
  }
}

/** A party's street and town as the PDF tore them ("Saarbr ü cken") */
function mendParty(fact: ContractPartyFact): void {
  fact.street = fact.street && mendAddressWords(fact.street)
  fact.city = fact.city && mendAddressWords(fact.city)
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
  taxNumber: '',
  website: '',
  countryCode: ''
})

/**
 * The promoter of a contract; null when the text names none. The labelled form wins over the
 * party block, the block is read up to the next party or the first clause.
 */
export function extractContractParty(
  text: string,
  links: readonly string[] = []
): ContractPartyFact | null {
  const segments = segmentsOf(
    text
      .replace(/(veranstalter\w*|vertreten\s+durch|nummer)\s*;/gi, '$1:')
      .replace(/\s+(?=vertreten\s+durch\s*:)/gi, '\n')
  ).filter(Boolean)

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
    // the whole party on one line: "Stadt Musterstadt, Kulturamt, Musterweg 1, 12345 Musterstadt",
    // "Muster GmbH Musterweg 1 . 12345 Musterstadt"
    const party = splitPartyName(value)
    if (!party.name && value) continue
    let name = party.name
    lines.push(...party.rest)
    if (name.includes(',')) {
      const parts = name.split(/\s*,\s*/).filter(Boolean)
      name = parts[0]
      lines.push(...parts.slice(1))
    }
    let next = index + 1
    if (!name && next < segments.length) {
      const nextPair = labelOf(segments[next])
      if (nextPair && PROMOTER.test(nextPair[0])) continue
      name = segments[next++]
    }
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
      // the show's site and date follow the promoter on many forms: not its address
      if (nextPair && SHEET_STOP.test(nextPair[0])) break
      lines.push(line)
    }
    if (!name || name.length > 120) continue
    const fact = { ...empty(), name: mendWords(name) }
    readBlock(fact, lines, links)
    mendParty(fact)
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
    const fact = {
      ...empty(),
      name: splitPartyName(name.replace(/^(der |die |the )?(firma\s+)?/i, '')).name
    }
    if (!fact.name) continue
    readBlock(
      fact,
      lines.filter((line) => line !== name),
      links
    )
    mendParty(fact)
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

const DATE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/

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
      const year = match?.[3].length === 2 ? `20${match[3]}` : match?.[3]
      if (match) fact.date = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
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

/** Labels of a sheet that start something other than the promoter: the site, the show, the act */
const SHEET_STOP =
  /^(veranstaltungsort|spielort|spielstaette|location|venue|gelaende|festivalgelaende|auftrittsort|datum|veranstaltungsdatum|auftrittsdatum|bandname|buehne|stage|zeitplan|zeiten|anreise|anfahrt|hotel|technik|techniker|tontechniker|production|produktion)/

/** "Adresse des Vereins", "Anschrift des Veranstalters", "Postanschrift" */
const ADDRESS_HEAD =
  /^(?:adresse|anschrift|postanschrift|vereinsadresse|vereinsanschrift)(?: (?:des|der) (?:vereins|veranstalters|veranstalter|veranstalterin))?\b/

/** The promoter's own label, without spaces: "Veranstalter:", "Promoter:", "Ausrichter:" */
const SHEET_PROMOTER =
  /^(veranstalter|veranstalterin|promoter|organi[sz]er|ausrichter|ausrichtung|promoterscompany|promotercompany|veranstalterfirma)$/

/** A heading of the promoter's block: "Veranstalter Details:", "Promoter / Veranstalter:" */
const SHEET_PROMOTER_HEAD =
  /^(veranstalter|promoter|organi[sz]er)(details|daten|infos?|kontakt|veranstalter|promoter)?$/

/** The company's name inside that block: "Firmenname:", "Firma:" */
const SHEET_COMPANY = /^(firmenname|firma|company|companyname|name|veranstalter|promoter)$/

/** The person in charge on a sheet */
const SHEET_PERSON =
  /^(hauptverantwortliche?r?|verantwortliche?r?|ansprechpartner(in)?|ansprechp|kontakt|contact|leitung|festivalleitung|veranstaltungsleitung|veranstaltername|vertretendurch)$/

const tightLabel = (segment: string): [string, string] | null => {
  const pair = labelOf(segment)
  return pair ? [pair[0].replace(/ /g, ''), pair[1]] : null
}

/** "Erika Muster & Max Beispiel" → the first one's name */
const firstPerson = (value: string): string =>
  personName(mendWords(value.split(/\s(?:&|und|and|\/|[-–])\s|,/)[0] ?? ''))

/**
 * The promoter of a festival's or club's info sheet: "Veranstalter: Muster e.V.", a block under
 * "Veranstalter:" or "Veranstalter Details:" (company name, address, phone, e-mail), the
 * promoter's own address under "Adresse des Vereins" (never the site's address under
 * "Veranstaltungsort"), the sheet's e-mail, website and phone and the person in charge. Null
 * when no label names one, or the label is a person's contact line ("Veranstalter: Erika Muster
 * – 0151 …").
 */
export function extractSheetPromoter(
  text: string,
  links: readonly string[] = []
): ContractPartyFact | null {
  const segments = segmentsOf(text).filter(Boolean)
  let at = -1
  let name = ''
  // the lines between a block's heading and the company found in it
  let above: string[] = []
  for (let index = 0; index < segments.length && at < 0; index++) {
    const own = keyOf(segments[index]).replace(/ /g, '')
    const pair =
      tightLabel(segments[index]) ??
      (/^(veranstalter|promoter|organi[sz]er)(infos?|details|daten|kontakt)/.test(own) &&
      own.length <= 40
        ? (['veranstalterdetails', ''] as [string, string])
        : null)
    if (!pair) continue
    const [label, value] = pair
    if (value && SHEET_PROMOTER.test(label)) {
      at = index
      name = value
    } else if (!value && SHEET_PROMOTER_HEAD.test(label)) {
      // the block: a "Firmenname:" in it, else its first line (a person running the show)
      for (let next = index + 1; next < Math.min(segments.length, index + 4); next++) {
        const inner = tightLabel(segments[next])
        if (inner && inner[1] && SHEET_COMPANY.test(inner[0])) {
          at = next
          name = inner[1]
          break
        }
      }
      // a company among the first lines ("Erika Muster", "Vorsitzende", "Muster e.V.")
      for (let next = index + 1; at < 0 && next < Math.min(segments.length, index + 5); next++) {
        const line = segments[next]
        if (!labelOf(line) && isCompanyLine(line) && !/\d{4,5}\s/.test(line)) {
          at = next
          name = line
          above = segments.slice(index + 1, next)
        }
      }
      if (at < 0 && index + 1 < segments.length && !labelOf(segments[index + 1])) {
        const first = segments[index + 1]
        if (!PHONE.test(first) && !/@/.test(first) && !/\d/.test(first)) {
          at = index + 1
          name = first
        }
      }
    }
  }
  if (at < 0) return null
  if (PHONE.test(name) || /@/.test(name) || name.length > 120) return null
  // "Ansprechp. Erika Muster" right below an empty "Promoter:" is a person, no promoter
  if (/^(ansprechp|kontakt|contact|tel|mobil|email)/i.test(name.replace(/[\s.-]/g, ''))) return null
  const party = splitPartyName(name.replace(/^(promoter|veranstalter)\s*:\s*/i, ''))
  if (!party.name) return null
  const fact = { ...empty(), name: party.name }

  // the block below the name, up to the next part of the sheet
  const block: string[] = []
  for (let next = at + 1; next < segments.length && block.length < 7; next++) {
    const segment = segments[next]
    const pair = tightLabel(segment)
    if (SHEET_STOP.test(pair?.[0] ?? keyOf(segment).replace(/ /g, ''))) break
    // another heading ("Venue Details:", "Techniker:") or the act's side ends the block
    if (pair && !pair[1] && !SHEET_PERSON.test(pair[0])) break
    if (pair && ARTIST_SIDE.test(pair[0])) break
    block.push(segment)
  }
  block.unshift(...party.rest)
  readBlock(fact, block, links)
  if (!fact.contactName) {
    const person = [...above, ...block].find((line) => !labelOf(line) && personName(line) !== '')
    if (person && keyOf(person) !== keyOf(fact.name)) {
      fact.contactName = personName(mendWords(person))
      fact.contactRole = 'Ansprechpartner'
    }
  }

  // the promoter's own address block
  const head = segments.findIndex((segment) => {
    const key = keyOf(segment)
    return ADDRESS_HEAD.test(key) && !/gelaende|veranstaltungsort|rechnung|anfahrt/.test(key)
  })
  if (head >= 0 && !fact.street) {
    const segment = segments[head]
    const own = cleanText(
      segment.includes(':')
        ? segment.slice(segment.indexOf(':') + 1)
        : segment.replace(
            /^\s*(?:adresse|anschrift|postanschrift|vereinsadresse|vereinsanschrift)(?:\s+(?:des|der)\s+\S+)?/i,
            ''
          )
    )
    // "Muster e.V." under the address is the promoter's name without the town behind it
    if (own && keyOf(fact.name).startsWith(keyOf(own)) && keyOf(own).length >= 4) fact.name = own
    const lines: string[] = []
    if (own && keyOf(own) !== keyOf(fact.name)) lines.push(own)
    for (let next = head + 1; next < segments.length && lines.length < 3; next++) {
      if (labelOf(segments[next])) break
      lines.push(segments[next])
    }
    readBlock(fact, lines, links)
  }

  for (const segment of segments) {
    const pair = tightLabel(segment)
    if (!pair || !pair[1]) continue
    const [label, value] = pair
    if (/^(email|mail|emailadresse)$/.test(label) && !fact.email) fact.email = emailOf(value, links)
    else if (/^(website|webseite|homepage|internet|web|url)$/.test(label) && !fact.website) {
      const site = joinSpacedDomain(value).split(/\s/)[0] ?? ''
      if (/\.[a-z]{2,}/i.test(site)) fact.website = site
    } else if (/^(tel|telefon|phone|fon|mobil|handy)$/.test(label) && !fact.phone) {
      const phone = PHONE.exec(value)?.[0]
      if (phone) fact.phone = cleanText(phone)
    } else if (SHEET_PERSON.test(label) && !fact.contactName) {
      const person = firstPerson(value)
      if (person && keyOf(person) !== keyOf(fact.name)) {
        fact.contactName = person
        fact.contactRole = /ansprech|kontakt|contact/.test(label) ? 'Ansprechpartner' : 'Leitung'
      }
    }
  }
  // "Erika Muster" named, "Muster Events" below: the company is the promoter, she its contact
  const company = block.find((line) => !labelOf(line) && isCompanyLine(line) && !/\d/.test(line))
  if (personName(fact.name) && company) {
    fact.contactName ||= fact.name
    fact.contactRole ||= 'Ansprechpartner'
    fact.name = splitPartyName(company).name || fact.name
  }
  mendParty(fact)
  return fact
}
