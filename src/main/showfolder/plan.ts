// From the facts of a show folder to what the dialog offers: where each file is filed and which
// values go into the event, its club, hotel and contacts. A suggestion that fills something
// empty starts ticked; one that would replace a stored value starts unticked and says what it
// replaces; one that matches what is stored is left out. Pure (tests/show_folder_plan.test.ts).

import { splitStreet } from '../einvoice/readParty'
import type { DocumentType } from '../api/schemas/document.schema'
import type {
  ShowFileOwner,
  ShowFolderFileDto,
  ShowFolderGroup,
  ShowFolderSuggestionDto
} from '../api/schemas/show_folder.schema'
import {
  ITINERARY_KEYS,
  keyOf,
  type ContactFact,
  type ItineraryKey,
  type PlaceKind,
  type ShowFacts,
  type ShowFileKind
} from './extract'

export const ITINERARY_LABELS: Record<ItineraryKey, string> = {
  getIn: 'Aufbau (Get-in)',
  loadIn: 'Laden (Load-in)',
  soundCheckMainAct: 'Soundcheck Hauptact',
  soundCheckSupport: 'Soundcheck Vorgruppe',
  dinner: 'Abendessen',
  doors: 'Einlass',
  showTimeSupport: 'Vorgruppe',
  showTimeMainAct: 'Hauptact',
  showLength: 'Showlänge (min)',
  curfewStage: 'Sperrzeit (Bühne)',
  curfewVenue: 'Sperrzeit (Club / Festival)'
}

/** Where a kind of file is filed and as what */
export function filingOf(kind: ShowFileKind): { owner: ShowFileOwner; documentType: DocumentType } {
  switch (kind) {
    case 'venue_spec':
      return { owner: 'venue', documentType: 'other' }
    case 'stage_plot':
      return { owner: 'venue', documentType: 'stage_plot' }
    case 'contract':
      return { owner: 'event', documentType: 'contract' }
    case 'settlement':
      return { owner: 'event', documentType: 'settlement' }
    case 'rider':
      return { owner: 'event', documentType: 'rider' }
    default:
      return { owner: 'event', documentType: 'other' }
  }
}

export interface ShowFileRead {
  path: string
  name: string
  kind: ShowFileKind
  /** The file had text (false: a scan, or a format that is not read) */
  readable: boolean
}

/** What is stored for the event now */
export interface ShowFolderCurrent {
  itinerary: Partial<Record<ItineraryKey, string>>
  presaleCents: number | null
  guaranteeCents: number | null
  deal: string
  venue: {
    name: string
    kind: PlaceKind
    capacity: number | null
    street: string
    streetNumber: string
    zipCode: string
    city: string
    notes: string
  } | null
  /** A stored club or festival with the files' venue name, for an event without one */
  venueByName: { id: number; name: string; kind: PlaceKind } | null
  hotel: { id: number; name: string } | null
  /** A stored hotel with the sheet's hotel name */
  hotelByName: { id: number; name: string } | null
  loproPersonId: number | null
  /** The event's promoter company (LoPro) */
  loproCompany: { id: number; name: string } | null
  /** A stored company with the contract's promoter name */
  companyByName: { id: number; name: string } | null
  /** Persons already Ansprechpartner of that company (or of the LoPro company) */
  companyMemberIds: ReadonlySet<number>
  localContactId: number | null
  /** Persons by lower-cased e-mail */
  personsByEmail: ReadonlyMap<string, { id: number; name: string }>
  venueMemberIds: ReadonlySet<number>
  /** File names already among the event's / the club's documents */
  eventDocuments: ReadonlySet<string>
  venueDocuments: ReadonlySet<string>
  hasSettlement: boolean
}

/** "Club" or "Festival": the word for a venue of that kind, also the suggestion group */
export const placeNoun = (kind: PlaceKind): 'Club' | 'Festival' =>
  kind === 'festival' ? 'Festival' : 'Club'

/**
 * The club or festival the files name, for an event that has none yet: the stored one of that
 * name, else a new one of the kind the files suggest (a club when they do not tell)
 */
export interface PendingVenue {
  venueId: number | null
  name: string
  kind: PlaceKind
}

export function pendingVenueOf(
  facts: ShowFacts,
  current: Pick<ShowFolderCurrent, 'venue' | 'venueByName'>
): PendingVenue | null {
  if (current.venue || !facts.venue.name) return null
  const known = current.venueByName
  if (known) return { venueId: known.id, name: known.name, kind: known.kind }
  return { venueId: null, name: facts.venue.name, kind: facts.venue.kind ?? 'venue' }
}

const euro = (cents: number): string =>
  `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Where each file goes, ticked unless it is the same sheet twice or already filed */
export function planFiles(
  files: readonly ShowFileRead[],
  current: Pick<ShowFolderCurrent, 'venue' | 'eventDocuments' | 'venueDocuments'>,
  pending: PendingVenue | null = null
): ShowFolderFileDto[] {
  return files.map((file) => {
    const filing = filingOf(file.kind)
    const { documentType } = filing
    let { owner } = filing
    let include = true
    let note = ''
    if (owner === 'venue' && !current.venue) {
      if (pending) {
        note = `Kommt zu ${pending.name} (${placeNoun(pending.kind)}), sobald es zugeordnet ist – sonst zum Event.`
      } else {
        owner = 'event'
        note = 'Das Event hat keinen Club und kein Festival, deshalb beim Event abgelegt.'
      }
    }
    if (file.kind === 'duplicate') {
      include = false
      note = 'Dasselbe Blatt liegt auch als PDF bei.'
    } else if (
      (owner === 'event' ? current.eventDocuments : current.venueDocuments).has(file.name)
    ) {
      include = false
      note = 'Liegt dort schon unter diesem Namen.'
    } else if (!file.readable && file.kind === 'other') {
      note = 'Kein Text lesbar (Scan) – wird nur abgelegt.'
    } else if (file.kind === 'permit') {
      note = 'Genehmigung – wird beim Event abgelegt.'
    }
    return { path: file.path, name: file.name, kind: file.kind, owner, documentType, include, note }
  })
}

/** "Elisa Beispiel" → first and last name; a single word is the first name */
function splitName(name: string): { firstName: string; lastName: string } {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return { firstName: words[0], lastName: '' }
  return { firstName: words.slice(0, -1).join(' '), lastName: words[words.length - 1] }
}

/**
 * The suggestions for the event. `sources` names the file each part of the facts came from,
 * for the "aus …" hint beside every suggestion.
 */
export function planSuggestions(
  facts: ShowFacts,
  current: ShowFolderCurrent,
  sources: { sheet: string; venue: string; mail: string; contract: string; settlement: string }
): ShowFolderSuggestionDto[] {
  const out: ShowFolderSuggestionDto[] = []
  const add = (
    group: ShowFolderGroup,
    id: string,
    label: string,
    currentText: string,
    proposed: string,
    source: string,
    action: ShowFolderSuggestionDto['action']
  ) => {
    out.push({
      id,
      group,
      label,
      current: currentText,
      proposed,
      include: currentText.trim() === '',
      source,
      action
    })
  }

  // the day
  const itinerary = { ...facts.itinerary }
  if (facts.start && !itinerary.showTimeMainAct && !itinerary.showTimeSupport)
    itinerary.showTimeMainAct = facts.start
  for (const field of ITINERARY_KEYS) {
    const value = itinerary[field]
    if (!value) continue
    const stored = current.itinerary[field] ?? ''
    if (stored === value) continue
    add(
      'Tagesablauf',
      `itinerary.${field}`,
      ITINERARY_LABELS[field],
      stored,
      value,
      sources.sheet,
      {
        type: 'itinerary',
        field,
        value
      }
    )
  }

  // tickets and deal
  const { tickets } = facts
  if (tickets.presaleCents !== null && tickets.presaleCents !== current.presaleCents) {
    const parts = [
      tickets.baseCents !== null ? `Grundpreis ${euro(tickets.baseCents)}` : '',
      tickets.extraCents !== null ? `Ausgleich ${euro(tickets.extraCents)}` : '',
      tickets.wkzCents !== null ? `WKZ ${euro(tickets.wkzCents)}` : ''
    ].filter(Boolean)
    add(
      'Tickets & Deal',
      'event.presale',
      'Ticketpreis VVK',
      current.presaleCents !== null ? euro(current.presaleCents) : '',
      `${euro(tickets.presaleCents)}${parts.length ? ` (${parts.join(', ')})` : ''}`,
      sources.mail,
      { type: 'eventPresale', cents: tickets.presaleCents }
    )
  }
  if (facts.deal.guaranteeCents !== null && facts.deal.guaranteeCents !== current.guaranteeCents) {
    add(
      'Tickets & Deal',
      'event.guarantee',
      'Garantie / Gage',
      current.guaranteeCents !== null ? euro(current.guaranteeCents) : '',
      euro(facts.deal.guaranteeCents),
      sources.contract,
      { type: 'eventGuarantee', cents: facts.deal.guaranteeCents }
    )
  }
  if (facts.deal.text && keyOf(facts.deal.text) !== keyOf(current.deal)) {
    add('Tickets & Deal', 'event.deal', 'Deal', current.deal, facts.deal.text, sources.contract, {
      type: 'eventDeal',
      text: facts.deal.text
    })
  }

  // the club or festival
  const venue = current.venue
  if (venue) {
    const group = placeNoun(venue.kind)
    const filesKind = facts.venue.kind
    if (filesKind && filesKind !== venue.kind) {
      add(
        placeNoun(filesKind),
        'venue.kind',
        `${venue.name}: laut den Dateien ${filesKind === 'festival' ? 'ein Festival' : 'ein Club'}`,
        placeNoun(venue.kind),
        placeNoun(filesKind),
        sources.venue,
        { type: 'venueKind', kind: filesKind }
      )
    }
    const { capacity } = facts.venue
    if (capacity !== null && capacity !== venue.capacity) {
      add(
        group,
        'venue.capacity',
        `Kapazität ${venue.name}`,
        venue.capacity !== null ? String(venue.capacity) : '',
        String(capacity),
        sources.venue,
        { type: 'venueCapacity', value: capacity }
      )
    }
    if (facts.venue.street && facts.venue.zipCode) {
      const { street, streetNumber } = splitStreet(facts.venue.street)
      const stored = [
        `${venue.street} ${venue.streetNumber}`.trim(),
        `${venue.zipCode} ${venue.city}`.trim()
      ]
        .filter(Boolean)
        .join(', ')
      const proposed =
        `${street} ${streetNumber}`.trim() + `, ${facts.venue.zipCode} ${facts.venue.city}`
      if (keyOf(stored) !== keyOf(proposed)) {
        add(group, 'venue.address', `Adresse ${venue.name}`, stored, proposed, sources.venue, {
          type: 'venueAddress',
          street,
          streetNumber,
          zipCode: facts.venue.zipCode,
          city: facts.venue.city
        })
      }
    }
    const lines = [
      ...(facts.venue.merchFeeCents !== null
        ? [`Merch-Fee: ${euro(facts.venue.merchFeeCents)}`]
        : []),
      ...facts.venue.notes
    ].filter((line) => !keyOf(venue.notes).includes(keyOf(line)))
    if (lines.length > 0) {
      out.push({
        id: 'venue.notes',
        group,
        label: `Infos zu ${venue.name} (an die Notiz anhängen)`,
        current: '',
        proposed: lines.join(' · '),
        include: true,
        source: sources.venue,
        action: { type: 'venueNotes', lines }
      })
    }
  }
  const pending = pendingVenueOf(facts, current)
  if (pending) out.push(venueAssignSuggestion(facts, pending, sources.venue))

  // the contract's promoter
  const company = promoterCompanyOf(facts, current)
  const companySuggestion = promoterSuggestion(facts, current, sources.contract || sources.mail)
  if (companySuggestion) out.push(companySuggestion)

  // the hotel
  const hotel = facts.hotel
  if (hotel.name && (!current.hotel || keyOf(current.hotel.name) !== keyOf(hotel.name))) {
    const { street, streetNumber } = splitStreet(hotel.street)
    const known = current.hotelByName
    out.push({
      id: 'hotel',
      group: 'Hotel',
      label: known ? 'Hotel zuordnen' : 'Hotel anlegen und zuordnen',
      current: current.hotel?.name ?? '',
      proposed: [
        hotel.name,
        [hotel.street, `${hotel.zipCode} ${hotel.city}`.trim()].filter(Boolean).join(', '),
        ...hotel.notes
      ]
        .filter(Boolean)
        .join(' · '),
      include: current.hotel === null,
      source: sources.sheet,
      action: {
        type: 'hotel',
        hotelId: known?.id ?? null,
        name: hotel.name,
        street,
        streetNumber,
        zipCode: hotel.zipCode,
        city: hotel.city,
        notes: hotel.notes.join('\n')
      }
    })
  }

  // contacts: the club's people and the promoter; the band's own crew is left out
  for (const contact of facts.contacts) {
    const suggestion = personSuggestion(contact, current, pending, company, sources)
    if (suggestion) out.push(suggestion)
  }

  return out
}

/** Assign the club or festival the files name to an event without one, creating it if new */
function venueAssignSuggestion(
  facts: ShowFacts,
  pending: PendingVenue,
  source: string
): ShowFolderSuggestionDto {
  const noun = placeNoun(pending.kind)
  const { street, streetNumber } = splitStreet(facts.venue.street)
  const notes = [
    ...(facts.venue.merchFeeCents !== null
      ? [`Merch-Fee: ${euro(facts.venue.merchFeeCents)}`]
      : []),
    ...facts.venue.notes
  ]
  const known = pending.venueId !== null
  return {
    id: 'venue.assign',
    group: noun,
    label: known
      ? `${noun} ${pending.name} zuordnen (schon angelegt)`
      : `${noun} ${pending.name} anlegen und zuordnen`,
    current: '',
    proposed: known
      ? pending.name
      : [
          pending.name,
          [facts.venue.street, `${facts.venue.zipCode} ${facts.venue.city}`.trim()]
            .filter(Boolean)
            .join(', '),
          facts.venue.capacity !== null ? `Kapazität ${facts.venue.capacity}` : '',
          ...notes
        ]
          .filter(Boolean)
          .join(' · '),
    include: true,
    source,
    action: {
      type: 'venueAssign',
      venueId: pending.venueId,
      name: pending.name,
      kind: pending.kind,
      street,
      streetNumber,
      zipCode: facts.venue.zipCode,
      city: facts.venue.city,
      capacity: facts.venue.capacity,
      notes:
        notes.length > 0
          ? ['Aus dem Show-Ordner:', ...notes.map((line) => `- ${line}`)].join('\n')
          : ''
    }
  }
}

/**
 * The company a contract names as the promoter: the event's LoPro company when it is that
 * one, else a stored company of that name, else a new one
 */
export function promoterCompanyOf(
  facts: ShowFacts,
  current: Pick<ShowFolderCurrent, 'loproCompany' | 'companyByName'>
): { id: number | null; name: string } | null {
  const promoter = facts.promoter
  if (!promoter?.name) return null
  if (current.loproCompany && keyOf(current.loproCompany.name) === keyOf(promoter.name))
    return current.loproCompany
  return current.companyByName ?? { id: null, name: promoter.name }
}

/** Create or pick the promoter company and enter it as the event's LoPro */
function promoterSuggestion(
  facts: ShowFacts,
  current: ShowFolderCurrent,
  source: string
): ShowFolderSuggestionDto | null {
  const promoter = facts.promoter
  const company = promoterCompanyOf(facts, current)
  if (!promoter || !company) return null
  // already the event's promoter: nothing to set
  if (company.id !== null && current.loproCompany?.id === company.id) return null
  const { street, streetNumber } = splitStreet(promoter.street)
  const known = company.id !== null
  return {
    id: 'company.promoter',
    group: 'Vertragspartner',
    label: known
      ? `Veranstalter ${company.name} eintragen (schon angelegt)`
      : `Veranstalter ${company.name} anlegen und eintragen`,
    current: current.loproCompany?.name ?? '',
    proposed: [
      company.name,
      [promoter.street, `${promoter.zipCode} ${promoter.city}`.trim()].filter(Boolean).join(', '),
      promoter.vatId ? `USt-IdNr. ${promoter.vatId}` : '',
      promoter.email,
      promoter.phone
    ]
      .filter(Boolean)
      .join(' · '),
    include: current.loproCompany === null,
    source,
    action: {
      type: 'company',
      companyId: company.id,
      name: company.name,
      street,
      streetNumber,
      zipCode: promoter.zipCode,
      city: promoter.city,
      email: promoter.email,
      phone: promoter.phone,
      vatId: promoter.vatId,
      lopro: true
    }
  }
}

function personSuggestion(
  contact: ContactFact,
  current: ShowFolderCurrent,
  pending: PendingVenue | null,
  company: { id: number | null; name: string } | null,
  sources: { sheet: string; venue: string; mail: string }
): ShowFolderSuggestionDto | null {
  if (contact.side !== 'venue' && contact.side !== 'promoter') return null
  const known = contact.email ? current.personsByEmail.get(contact.email.toLowerCase()) : undefined
  // the club or festival the person joins: the event's, or the one the plan assigns
  const place = current.venue ?? pending
  const venue = contact.side === 'venue' && place !== null
  const venueMember = venue && !(known && current.venueMemberIds.has(known.id))
  const localContact = contact.side === 'venue' && contact.onSite && current.localContactId === null
  const lopro = contact.side === 'promoter' && current.loproPersonId === null
  const companyMember =
    contact.side === 'promoter' &&
    company !== null &&
    !(known && current.companyMemberIds.has(known.id))
  // nothing to link (already linked, or no club and no free role): nothing to offer
  if (!venueMember && !localContact && !lopro && !companyMember) return null

  const roles = [
    venueMember ? `Ansprechpartner von ${place?.name}` : '',
    companyMember ? `Ansprechpartner von ${company?.name}` : '',
    localContact ? 'Kontakt vor Ort' : '',
    lopro ? 'LoPro-Kontakt' : ''
  ].filter(Boolean)
  const { firstName, lastName } = splitName(contact.name)
  return {
    id: `person.${keyOf(contact.email || contact.name)}`,
    group: 'Kontakte',
    label: `${contact.name}${known ? ' (schon angelegt)' : ''}`,
    current: '',
    proposed: [
      contact.role,
      contact.email,
      contact.phone,
      roles.length ? `→ ${roles.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join(' · '),
    include: true,
    source:
      contact.side === 'promoter' ? sources.mail : contact.onSite ? sources.sheet : sources.venue,
    action: {
      type: 'person',
      personId: known?.id ?? null,
      firstName,
      lastName,
      email: contact.email,
      phone: contact.phone,
      role: contact.role,
      venueMember,
      localContact,
      lopro,
      companyMember
    }
  }
}

/** The promoter's settlement sheet of the folder, offered while the event has none */
export function settlementSuggestion(
  file: { path: string; name: string } | null,
  hasSettlement: boolean
): ShowFolderSuggestionDto | null {
  if (!file || hasSettlement) return null
  return {
    id: 'settlement',
    group: 'Abrechnung',
    label: 'Abrechnung des Veranstalters übernehmen',
    current: '',
    proposed: `Aus „${file.name}“ – die Tickets werden auch als Verkaufsmeldung eingetragen`,
    include: true,
    source: file.name,
    action: { type: 'settlement', path: file.path }
  }
}
