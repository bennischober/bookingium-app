import type { ImportPreview, ImportTarget } from '../../../../main/api/schemas/import.schema'
import type { VenueKind } from '../../../../main/api/schemas/venue.schema'
import { COMPANY_KIND_LABELS, type CompanyKind } from '../../../../main/api/schemas/company.schema'

// Labels and column layout of the import dialog's steps

export type Entity = keyof ImportPreview['summary']

const KIND_PLURALS: Record<VenueKind, string> = {
  venue: 'Clubs',
  festival: 'Festivals'
}

/** Preview columns per target (null = column not shown) */
export const PREVIEW_COLUMNS: Record<
  ImportTarget,
  { primary: string | null; company: string; persons: string | null; continuation: string }
> = {
  venues: {
    primary: null, // Club / Festival, by kind
    company: 'Veranstalter',
    persons: 'Ansprechpartner',
    continuation: 'weiterer Kontakt zur Zeile darüber'
  },
  bands: {
    primary: 'Band',
    company: 'Firma',
    persons: 'Mitglieder',
    continuation: 'weitere Mitglieder der Band darüber'
  },
  companies: {
    primary: null,
    company: 'Firma',
    persons: 'Ansprechpartner',
    continuation: 'weiterer Kontakt zur Firma darüber'
  },
  persons: { primary: 'Person', company: 'Firma', persons: null, continuation: '' }
}

/** Record types a target creates, in summary order */
export function summaryEntities(
  target: ImportTarget,
  kind: VenueKind,
  companyKind: CompanyKind
): Array<[Entity, string]> {
  const companies = companyKind === 'media' ? COMPANY_KIND_LABELS.media : 'Firmen'
  switch (target) {
    case 'venues':
      return [
        ['venues', KIND_PLURALS[kind]],
        ['companies', 'Veranstalter'],
        ['persons', 'Ansprechpartner']
      ]
    case 'bands':
      return [
        ['bands', 'Bands'],
        ['persons', 'Personen']
      ]
    case 'companies':
      return [
        ['companies', companies],
        ['persons', 'Ansprechpartner']
      ]
    case 'persons':
      return [
        ['persons', 'Personen'],
        ['companies', companies]
      ]
  }
}

// "1 Band angelegt" (labels that differ in the singular)
export const SINGULAR: Record<string, string> = {
  Clubs: 'Club',
  Festivals: 'Festival',
  Bands: 'Band',
  Firmen: 'Firma',
  Personen: 'Person'
}

/** Spreadsheet column letter: 0 → A, 26 → AA */
export function columnLetter(index: number): string {
  let letter = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
  }
  return letter
}
