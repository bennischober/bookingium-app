// The domain nouns the UI names, in one place (#105). German only, no i18n.
// What derives from here: labels that are just the noun (ROUTES titles, quick
// create, kind labels, export/import labels, CSV headers) and components that
// render one of several nouns (a club or a festival list: VENUE_KIND_TERMS).
// Sentences stay plain German literals, so the UI text can be found by searching
// for it. AVOIDED_WORDS keeps competing words out (tests/terms_guard.test.ts).
// Pure module: main imports it directly, the renderer by relative path like
// the schemas.

export type Gender = 'm' | 'f' | 'n'

type NounSpec = {
  singular: string
  plural: string
  gender: Gender
  /** Genitive singular, if not the regular one (masculine/neuter + s) */
  genitive?: string
  /** Dative plural, if not the regular one (plural + n, unless it ends in n or s) */
  pluralDative?: string
}

/**
 * One noun with the forms the UI uses. The article keys are named after the
 * masculine form of each case, so they are unambiguous for every gender:
 * `einen` is the accusative with an indefinite article - "einen Club",
 * "eine Firma", "ein Festival". Plural articles do not depend on the gender,
 * so sentences write them out: `die ${t.plural}`, `den ${t.pluralDative}`.
 * Article forms are lower case; `capitalize()` starts a sentence with one.
 */
export type Term = {
  singular: string
  plural: string
  gender: Gender
  /** Genitive singular noun without article: "Clubs", "Firma" */
  genitive: string
  /** Dative plural noun without article: "Clubs", "Verteilern" */
  pluralDative: string
  der: string
  den: string
  dem: string
  des: string
  ein: string
  einen: string
  einem: string
  eines: string
  kein: string
  keinen: string
  /** Label forms, capitalised: "Neuer Club" (nominative), "Neuen Club anlegen" (accusative) */
  Neuer: string
  Neuen: string
}

const ARTICLES: Record<
  Gender,
  Record<
    | 'der'
    | 'den'
    | 'dem'
    | 'des'
    | 'ein'
    | 'einen'
    | 'einem'
    | 'eines'
    | 'kein'
    | 'keinen'
    | 'Neuer'
    | 'Neuen',
    string
  >
> = {
  m: {
    der: 'der',
    den: 'den',
    dem: 'dem',
    des: 'des',
    ein: 'ein',
    einen: 'einen',
    einem: 'einem',
    eines: 'eines',
    kein: 'kein',
    keinen: 'keinen',
    Neuer: 'Neuer',
    Neuen: 'Neuen'
  },
  f: {
    der: 'die',
    den: 'die',
    dem: 'der',
    des: 'der',
    ein: 'eine',
    einen: 'eine',
    einem: 'einer',
    eines: 'einer',
    kein: 'keine',
    keinen: 'keine',
    Neuer: 'Neue',
    Neuen: 'Neue'
  },
  n: {
    der: 'das',
    den: 'das',
    dem: 'dem',
    des: 'des',
    ein: 'ein',
    einen: 'ein',
    einem: 'einem',
    eines: 'eines',
    kein: 'kein',
    keinen: 'kein',
    Neuer: 'Neues',
    Neuen: 'Neues'
  }
}

function noun(spec: NounSpec): Term {
  const genitive = spec.genitive ?? (spec.gender === 'f' ? spec.singular : `${spec.singular}s`)
  const pluralDative =
    spec.pluralDative ?? (/[ns]$/.test(spec.plural) ? spec.plural : `${spec.plural}n`)
  const a = ARTICLES[spec.gender]
  return {
    singular: spec.singular,
    plural: spec.plural,
    gender: spec.gender,
    genitive,
    pluralDative,
    der: `${a.der} ${spec.singular}`,
    den: `${a.den} ${spec.singular}`,
    dem: `${a.dem} ${spec.singular}`,
    des: `${a.des} ${genitive}`,
    ein: `${a.ein} ${spec.singular}`,
    einen: `${a.einen} ${spec.singular}`,
    einem: `${a.einem} ${spec.singular}`,
    eines: `${a.eines} ${genitive}`,
    kein: `${a.kein} ${spec.singular}`,
    keinen: `${a.keinen} ${spec.singular}`,
    Neuer: `${a.Neuer} ${spec.singular}`,
    Neuen: `${a.Neuen} ${spec.singular}`
  }
}

/** Every business object the UI names. Stored values are not here: they go through label maps. */
export const TERMS = {
  band: noun({ singular: 'Band', plural: 'Bands', gender: 'f' }),
  // A venue of kind 'venue' (#101)
  club: noun({ singular: 'Club', plural: 'Clubs', gender: 'm' }),
  festival: noun({ singular: 'Festival', plural: 'Festivals', gender: 'n' }),
  company: noun({ singular: 'Firma', plural: 'Firmen', gender: 'f' }),
  person: noun({ singular: 'Person', plural: 'Personen', gender: 'f' }),
  event: noun({ singular: 'Event', plural: 'Events', gender: 'n' }),
  invoice: noun({ singular: 'Rechnung', plural: 'Rechnungen', gender: 'f' }),
  contactList: noun({ singular: 'Verteiler', plural: 'Verteiler', gender: 'm' }),
  hotel: noun({ singular: 'Hotel', plural: 'Hotels', gender: 'n' }),
  bank: noun({ singular: 'Bank', plural: 'Banken', gender: 'f' }),
  contract: noun({ singular: 'Vertrag', plural: 'Verträge', gender: 'm' })
} as const satisfies Record<string, Term>

export type TermKey = keyof typeof TERMS

const VENUE_TERM = `${TERMS.club.singular} / ${TERMS.festival.singular}`

/**
 * Words that compete with a term, and what to write instead. The guard test
 * fails when one is a whole word in a UI string: case-sensitive, so compounds
 * like "Veranstaltungsort" and the legal text of the contract documents are not
 * affected. docs/UI_LANGUAGE.md has the full glossary.
 */
export const AVOIDED_WORDS: Readonly<Record<string, string>> = {
  // #101 replaced "Spielstätte" with the two venue kinds
  Spielstätte: VENUE_TERM,
  Spielstätten: VENUE_TERM,
  Spielort: VENUE_TERM,
  Spielorte: VENUE_TERM,
  Location: VENUE_TERM,
  Locations: VENUE_TERM,
  Venue: VENUE_TERM,
  Venues: VENUE_TERM,
  Gig: TERMS.event.singular,
  Gigs: TERMS.event.plural,
  Veranstaltung: TERMS.event.singular,
  Veranstaltungen: TERMS.event.plural,
  Künstler: TERMS.band.singular,
  Künstlers: TERMS.band.genitive,
  Unternehmen: TERMS.company.singular,
  Kontaktliste: TERMS.contactList.singular,
  Kontaktlisten: TERMS.contactList.plural,
  Mailingliste: TERMS.contactList.singular,
  Mailinglisten: TERMS.contactList.plural,
  Verteilerliste: TERMS.contactList.singular,
  Verteilerlisten: TERMS.contactList.plural,
  Konzertvertrag: `${TERMS.contract.singular} (Auftrittsvertrag)`,
  Konzertverträge: `${TERMS.contract.plural} (Auftrittsverträge)`,
  Konzertverträgen: `${TERMS.contract.pluralDative} (Auftrittsverträgen)`
}

/**
 * Names of other products, written as their makers write them. They may contain an avoided
 * word (DATEV's "Unternehmen online"), which is why they live here and not inline.
 */
export const PRODUCT_NAMES = {
  datevOnline: 'DATEV Unternehmen online'
} as const

/** Starts a sentence with an article form: capitalize(TERMS.club.der) -> "Der Club" */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
