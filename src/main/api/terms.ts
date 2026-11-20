// The domain nouns the UI names, in one place (#105). #254: in German and English; TERMS
// gives the forms of the current UI language (src/main/i18n/translate.ts).
// What derives from here: labels that are just the noun (ROUTES titles, quick
// create, kind labels, export/import labels, CSV headers) and components that
// render one of several nouns (a club or a festival list: VENUE_KIND_TERMS).
// Sentences stay plain German literals, so the UI text can be found by searching
// for it. AVOIDED_WORDS keeps competing words out (tests/terms_guard.test.ts).
// Pure module: main imports it directly, the renderer by relative path like
// the schemas.

import { getLanguage } from '../i18n/translate'

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

/** Every business object the UI names, in German. Stored values go through label maps. */
export const TERMS_DE = {
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

export type TermKey = keyof typeof TERMS_DE

/**
 * #254: the same nouns in English. English has no grammatical gender or case, so the article
 * keys keep their German names and carry the English phrase: `einen` -> "a club", `der` ->
 * "the club", `des` -> "the club" (sentences write "of" themselves), `Neuer` -> "New club" as a
 * label, `Neuen` -> "new club" after a verb ("Create new club"). Nouns inside a phrase are lower
 * case; singular and plural stay capitalised for labels.
 */
function englishNoun(singular: string, plural: string, article: 'a' | 'an' = 'a'): Term {
  const lower = singular.toLowerCase()
  return {
    singular,
    plural,
    gender: 'n',
    genitive: singular,
    pluralDative: plural,
    der: `the ${lower}`,
    den: `the ${lower}`,
    dem: `the ${lower}`,
    des: `the ${lower}`,
    ein: `${article} ${lower}`,
    einen: `${article} ${lower}`,
    einem: `${article} ${lower}`,
    eines: `${article} ${lower}`,
    kein: `no ${lower}`,
    keinen: `no ${lower}`,
    Neuer: `New ${lower}`,
    Neuen: `new ${lower}`
  }
}

export const TERMS_EN = {
  band: englishNoun('Band', 'Bands'),
  club: englishNoun('Club', 'Clubs'),
  festival: englishNoun('Festival', 'Festivals'),
  company: englishNoun('Company', 'Companies'),
  person: englishNoun('Person', 'People'),
  event: englishNoun('Event', 'Events', 'an'),
  invoice: englishNoun('Invoice', 'Invoices', 'an'),
  contactList: englishNoun('Mailing list', 'Mailing lists'),
  hotel: englishNoun('Hotel', 'Hotels'),
  bank: englishNoun('Bank', 'Banks'),
  contract: englishNoun('Contract', 'Contracts')
} as const satisfies Record<TermKey, Term>

/**
 * The nouns in the current UI language. Each key is a getter, so a module that reads
 * `TERMS.band.plural` gets the language that was set before it ran.
 */
export const TERMS: Readonly<Record<TermKey, Term>> = Object.defineProperties(
  {},
  Object.fromEntries(
    (Object.keys(TERMS_DE) as TermKey[]).map((key) => [
      key,
      {
        enumerable: true,
        get: (): Term => (getLanguage() === 'en' ? TERMS_EN : TERMS_DE)[key]
      }
    ])
  )
) as Readonly<Record<TermKey, Term>>

const VENUE_TERM = `${TERMS_DE.club.singular} / ${TERMS_DE.festival.singular}`

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
  Gig: TERMS_DE.event.singular,
  Gigs: TERMS_DE.event.plural,
  Veranstaltung: TERMS_DE.event.singular,
  Veranstaltungen: TERMS_DE.event.plural,
  Künstler: TERMS_DE.band.singular,
  Künstlers: TERMS_DE.band.genitive,
  Unternehmen: TERMS_DE.company.singular,
  Kontaktliste: TERMS_DE.contactList.singular,
  Kontaktlisten: TERMS_DE.contactList.plural,
  Mailingliste: TERMS_DE.contactList.singular,
  Mailinglisten: TERMS_DE.contactList.plural,
  Verteilerliste: TERMS_DE.contactList.singular,
  Verteilerlisten: TERMS_DE.contactList.plural,
  Konzertvertrag: `${TERMS_DE.contract.singular} (Auftrittsvertrag)`,
  Konzertverträge: `${TERMS_DE.contract.plural} (Auftrittsverträge)`,
  Konzertverträgen: `${TERMS_DE.contract.pluralDative} (Auftrittsverträgen)`
}

/**
 * #254: the same for the English UI texts (src/main/i18n/en.ts); tests/i18n_guard.test.ts
 * fails when one is a whole word in a translation.
 */
export const AVOIDED_WORDS_EN: Readonly<Record<string, string>> = {
  Venue: `${TERMS_EN.club.singular} / ${TERMS_EN.festival.singular}`,
  Venues: `${TERMS_EN.club.plural} / ${TERMS_EN.festival.plural}`,
  venue: `${TERMS_EN.club.der} / ${TERMS_EN.festival.der}`,
  venues: `${TERMS_EN.club.plural} / ${TERMS_EN.festival.plural}`,
  Location: `${TERMS_EN.club.singular} / ${TERMS_EN.festival.singular}`,
  Locations: `${TERMS_EN.club.plural} / ${TERMS_EN.festival.plural}`,
  Gig: TERMS_EN.event.singular,
  Gigs: TERMS_EN.event.plural,
  gig: TERMS_EN.event.einen,
  gigs: TERMS_EN.event.plural,
  Artist: TERMS_EN.band.singular,
  Artists: TERMS_EN.band.plural,
  artist: TERMS_EN.band.einen,
  artists: TERMS_EN.band.plural,
  Organisation: TERMS_EN.company.singular,
  Organization: TERMS_EN.company.singular,
  Distribution: TERMS_EN.contactList.singular
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
