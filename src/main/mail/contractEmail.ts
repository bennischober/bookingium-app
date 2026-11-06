// #120: the email a concert or management contract is sent with: recipient from the
// contract's other party, subject and text from the "Vertrag" template in the settings
// (per language) with the contract's values filled into the {Platzhalter}.
//
// Pure (no Node or Electron APIs): the renderer imports it for the language default.
import type { ContractData, ContractParty } from '../api/schemas/contract.schema'
import type { ManagementContractPrintData } from '../api/schemas/management_contract.schema'
import type { EmailTemplate } from '../api/schemas/settings.schema'
import type { EmailDraft } from './eml'
import { fillPlaceholders, formatDate, tidySubject, type Lang } from './invoiceEmail'
import { findCountry } from '../import/normalize'

export type ContractDocument = 'concert' | 'management'

/** The placeholders the contract template can use, in the order the settings list them */
export const CONTRACT_EMAIL_PLACEHOLDERS = [
  'Dokument',
  'Band',
  'Datum',
  'Veranstaltungsort',
  'Empfänger',
  'Absender'
] as const
export type ContractEmailPlaceholder = (typeof CONTRACT_EMAIL_PLACEHOLDERS)[number]

/** What the email needs from either contract */
export type ContractEmailData = {
  document: ContractDocument
  band: string
  /** ISO date: the concert's, or the management contract's start */
  date: string | null
  venue: string
  recipient: ContractParty | null
  sender: ContractParty | null
}

/** A concert contract goes to the promoter; it comes from the representing agency, else the artist */
export function concertContractEmailData(data: ContractData): ContractEmailData {
  return {
    document: 'concert',
    band: data.band?.name ?? '',
    date: data.dealMemo.date,
    venue: data.venue?.name ?? '',
    recipient: data.promoter,
    sender: data.representative ?? data.artist
  }
}

/** A management contract goes to the band's company; it comes from the management */
export function managementContractEmailData(data: ManagementContractPrintData): ContractEmailData {
  return {
    document: 'management',
    band: data.band.name,
    date: data.contract.startDate,
    venue: '',
    recipient: data.artist,
    sender: data.management
  }
}

// Countries whose recipients get the German text
const GERMAN_SPEAKING = new Set(['DE', 'AT', 'CH', 'LI'])

/**
 * The email's default language: German for a German-speaking country and for one that
 * is empty or not recognised (the address's country is free text: "Österreich", "UK")
 */
export function contractEmailLang(country: string | null | undefined): Lang {
  const code = findCountry((country ?? '').trim())?.code
  return !code || GERMAN_SPEAKING.has(code) ? 'de' : 'en'
}

const DOCUMENT_NAMES: Record<ContractDocument, Record<Lang, string>> = {
  concert: { de: 'Konzertvertrag', en: 'Concert Contract' },
  management: { de: 'Managementvertrag', en: 'Management Agreement' }
}

/** A company's person to sign as, else the company */
function partyName(party: ContractParty | null): string {
  return (party?.representative || party?.name || '').trim()
}

export function contractEmailValues(
  data: ContractEmailData,
  lang: Lang
): Record<ContractEmailPlaceholder, string> {
  return {
    Dokument: DOCUMENT_NAMES[data.document][lang],
    Band: data.band,
    Datum: formatDate(data.date),
    Veranstaltungsort: data.venue,
    Empfänger: (data.recipient?.name ?? '').trim(),
    Absender: partyName(data.sender)
  }
}

export function contractEmail(
  data: ContractEmailData,
  lang: Lang,
  template: EmailTemplate
): EmailDraft {
  const values = contractEmailValues(data, lang)
  return {
    to: (data.recipient?.email ?? '').trim(),
    subject: tidySubject(fillPlaceholders(template.subject, values)),
    body: fillPlaceholders(template.body, values)
  }
}
