// ========================================
// A label copy against a release (#289): the preview and the merge
// ========================================
// Pure. A label copy usually fills a release step by step (the digital copy first, the vinyl
// later), so nothing is thrown away: empty fields are filled, tracks and products are matched
// by their codes (ISRC, UPC, catalogue number, else the title), and a value that differs from
// what the release holds only replaces it when the user says so.
import type {
  ContributorDto,
  ContributorInput,
  ProductDto,
  ReleaseDetailDto,
  ReleaseFields,
  SaveProductData,
  SaveTrackData,
  TrackDto,
  WorkShareDto,
  WorkShareInput
} from '../../api/schemas/release.schema'
import { RELEASE_FORMAT_LABELS, RELEASE_TYPE_LABELS } from '../../api/schemas/release.schema'
import type {
  BudgetLinePlan,
  HeadFieldPlan,
  ImportStatus,
  ParsedLabelCopy,
  ParsedProduct,
  ParsedReleaseHead,
  ParsedTrack,
  RowPlan
} from '../../api/schemas/release_import.schema'
import { formatDuration, normalizeCode } from '../codes'
import { keyText } from './values'
import { t } from '../../i18n/translate'

type HeadField = Exclude<keyof ParsedReleaseHead, never>

const HEAD_FIELDS: Array<{ field: HeadField; label: () => string }> = [
  { field: 'artistName', label: () => t('Artist') },
  { field: 'title', label: () => t('Titel') },
  { field: 'version', label: () => t('Version') },
  { field: 'releaseType', label: () => t('Art') },
  { field: 'releaseDate', label: () => t('VÖ-Datum') },
  { field: 'originalReleaseDate', label: () => t('Erst-VÖ') },
  { field: 'preorderD2cDate', label: () => t('Pre-Order D2C') },
  { field: 'preorderRetailDate', label: () => t('Pre-Order Handel') },
  { field: 'preorderDigitalDate', label: () => t('Pre-Order digital') },
  { field: 'label', label: () => t('Label') },
  { field: 'catalogNumber', label: () => t('Katalognummer') },
  { field: 'pLine', label: () => t('℗-Zeile') },
  { field: 'cLine', label: () => t('©-Zeile') },
  { field: 'genre', label: () => t('Genre') },
  { field: 'subGenre', label: () => t('Subgenre') },
  { field: 'metadataLanguage', label: () => t('Sprache der Metadaten') },
  { field: 'recordingCountry', label: () => t('Aufnahmeland') },
  { field: 'projectNumber', label: () => t('Projektnummer') }
]

export const HEAD_FIELD_NAMES: readonly string[] = HEAD_FIELDS.map((f) => f.field)

const germanDate = (iso: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso
}

function shown(field: HeadField, value: string | null): string {
  if (!value) return ''
  if (field === 'releaseType') return RELEASE_TYPE_LABELS[value as keyof typeof RELEASE_TYPE_LABELS]
  if (/Date$/.test(field)) return germanDate(value)
  return value
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function statusOf(current: string, incoming: string): ImportStatus {
  if (!current) return 'fill'
  return same(current, incoming) ? 'same' : 'conflict'
}

// ---------- matching ----------

/** The release's track for a track of the file: same ISRC, else the same title */
export function matchTrack(tracks: TrackDto[], incoming: ParsedTrack): TrackDto | null {
  const isrc = normalizeCode(incoming.isrc)
  if (isrc) {
    const byCode = tracks.find((track) => normalizeCode(track.isrc) === isrc)
    if (byCode) return byCode
  }
  const title = keyText(incoming.title)
  return (
    tracks.find(
      (track) => keyText(track.title) === title && (!isrc || !normalizeCode(track.isrc))
    ) ?? null
  )
}

/** The release's product for a product of the file: same UPC, else the same catalogue number */
export function matchProduct(products: ProductDto[], incoming: ParsedProduct): ProductDto | null {
  const upc = normalizeCode(incoming.upc)
  if (upc) {
    const byCode = products.find((product) => normalizeCode(product.upc) === upc)
    if (byCode) return byCode
  }
  const catalog = keyText(incoming.catalogNumber)
  if (catalog) {
    const byCatalog = products.find(
      (product) =>
        keyText(product.catalogNumber) === catalog && (!upc || !normalizeCode(product.upc))
    )
    if (byCatalog) return byCatalog
  }
  // a product without codes on both sides: the same format and name, so a second import of the
  // same file does not add it again
  if (!upc && !catalog) {
    const label = keyText(productLabel(incoming))
    return (
      products.find(
        (product) =>
          !normalizeCode(product.upc) &&
          !keyText(product.catalogNumber) &&
          keyText(productLabel(product)) === label
      ) ?? null
    )
  }
  return null
}

// ---------- comparing ----------

const contributorKey = (c: { name: string; role: string; instrument: string }) =>
  `${keyText(c.name)}|${keyText(c.role)}|${keyText(c.instrument)}`
const shareKey = (s: { name: string; role: string; sharePercent: number | null }) =>
  `${keyText(s.name)}|${s.role}|${s.sharePercent ?? ''}`

function sameSet<T>(a: T[], b: T[], key: (item: T) => string): boolean {
  const left = new Set(a.map(key))
  const right = new Set(b.map(key))
  return left.size === right.size && [...left].every((k) => right.has(k))
}

type Compared = { status: ImportStatus; conflicts: string[]; fills: number }

/** Compares field by field: [label, current, incoming]; an empty incoming value says nothing */
function compare(pairs: Array<[string, string, string]>): Compared {
  const conflicts: string[] = []
  let fills = 0
  for (const [label, current, incoming] of pairs) {
    if (!incoming) continue
    if (!current) fills++
    else if (!same(current, incoming)) conflicts.push(label)
  }
  return {
    status: conflicts.length > 0 ? 'conflict' : fills > 0 ? 'fill' : 'same',
    conflicts,
    fills
  }
}

const num = (value: number | null) => (value === null ? '' : String(value))
const flag = (value: boolean | null) => (value === null ? '' : value ? 'ja' : 'nein')

function trackPairs(track: TrackDto, incoming: ParsedTrack): Array<[string, string, string]> {
  return [
    [t('Titel'), track.title, incoming.title],
    [t('Version'), track.version, incoming.version],
    [t('Dauer'), num(track.durationSeconds), num(incoming.durationSeconds)],
    ['ISRC', normalizeCode(track.isrc), normalizeCode(incoming.isrc)],
    [
      t('Explicit'),
      incoming.explicit === null ? '' : flag(track.explicit),
      flag(incoming.explicit)
    ],
    [t('Genre'), track.genre, incoming.genre],
    [t('℗-Zeile'), track.pLine, incoming.pLine],
    [t('©-Zeile'), track.cLine, incoming.cLine],
    [t('Video-ISRC'), normalizeCode(track.videoIsrc), normalizeCode(incoming.videoIsrc)],
    [t('Songtext'), track.lyrics, incoming.lyrics]
  ]
}

function compareTrack(track: TrackDto, incoming: ParsedTrack): Compared {
  const result = compare(trackPairs(track, incoming))
  const lists: Array<[string, boolean, boolean, boolean]> = [
    [
      t('Mitwirkende'),
      track.contributors.length === 0,
      incoming.contributors.length === 0,
      sameSet<{ name: string; role: string; instrument: string }>(
        track.contributors,
        incoming.contributors,
        contributorKey
      )
    ],
    [
      t('Urheber'),
      track.workShares.length === 0,
      incoming.workShares.length === 0,
      sameSet<{ name: string; role: string; sharePercent: number | null }>(
        track.workShares,
        incoming.workShares,
        shareKey
      )
    ]
  ]
  for (const [label, currentEmpty, incomingEmpty, equal] of lists) {
    if (incomingEmpty) continue
    if (currentEmpty) result.fills++
    else if (!equal) result.conflicts.push(label)
  }
  result.status = result.conflicts.length > 0 ? 'conflict' : result.fills > 0 ? 'fill' : 'same'
  return result
}

/** The track keys of a product's tracklist, for comparing it with the file's */
function tracklistKeys(product: ProductDto, tracks: TrackDto[]): string {
  return product.tracks
    .map((pt) => {
      const track = tracks.find((tr) => tr.id === pt.trackId)
      return track
        ? `${normalizeCode(track.isrc) || keyText(track.title)}:${pt.disc}:${pt.side}`
        : ''
    })
    .join(',')
}

function incomingTracklistKeys(product: ParsedProduct, parsed: ParsedLabelCopy): string {
  return product.tracks
    .map((pt) => {
      const track = parsed.tracks.find((tr) => tr.key === pt.trackKey)
      return track
        ? `${normalizeCode(track.isrc) || keyText(track.title)}:${pt.disc}:${pt.side}`
        : ''
    })
    .join(',')
}

function productPairs(
  product: ProductDto,
  incoming: ParsedProduct
): Array<[string, string, string]> {
  return [
    [t('Format'), product.format, incoming.format === 'other' ? '' : incoming.format],
    [t('Bezeichnung'), product.title, incoming.title],
    [t('Verpackung'), product.packaging, incoming.packaging],
    [t('Farbe / Variante'), product.color, incoming.color],
    ['UPC / EAN', normalizeCode(product.upc), normalizeCode(incoming.upc)],
    [t('Katalognummer'), product.catalogNumber, incoming.catalogNumber],
    [t('Territorium'), product.territory, incoming.territory],
    [t('Discs'), num(product.discCount), num(incoming.discCount)],
    [t('VÖ-Datum'), product.releaseDate ?? '', incoming.releaseDate ?? ''],
    [t('Preiscode'), product.priceCode, incoming.priceCode],
    ['Box Lot', num(product.boxLot), num(incoming.boxLot)]
  ]
}

function compareProduct(
  product: ProductDto,
  incoming: ParsedProduct,
  release: ReleaseDetailDto,
  parsed: ParsedLabelCopy
): Compared {
  const result = compare(productPairs(product, incoming))
  const incomingList = incomingTracklistKeys(incoming, parsed)
  if (incomingList) {
    if (product.tracks.length === 0) result.fills++
    else if (tracklistKeys(product, release.tracks) !== incomingList)
      result.conflicts.push(t('Trackliste'))
  }
  result.status = result.conflicts.length > 0 ? 'conflict' : result.fills > 0 ? 'fill' : 'same'
  return result
}

export function productLabel(product: {
  format: string
  title: string
  packaging: string
  color: string
}) {
  return [
    RELEASE_FORMAT_LABELS[product.format as keyof typeof RELEASE_FORMAT_LABELS] ?? product.format,
    product.title,
    product.packaging,
    product.color
  ]
    .filter(Boolean)
    .join(' · ')
}

// ---------- the preview ----------

export type LabelCopyPlanParts = {
  head: HeadFieldPlan[]
  tracks: RowPlan[]
  products: RowPlan[]
  credits: { incoming: number; added: number }
  budget: BudgetLinePlan[]
}

export function budgetKey(line: { kind: string; title: string }) {
  return `${line.kind}|${keyText(line.title)}`
}

/** What the import would do to `release` (null: a new release) */
export function planLabelCopy(
  parsed: ParsedLabelCopy,
  release: ReleaseDetailDto | null,
  existingMeasures: Array<{ kind: string; title: string }> = []
): LabelCopyPlanParts {
  const head: HeadFieldPlan[] = []
  for (const { field, label } of HEAD_FIELDS) {
    const incoming = parsed.head[field]
    if (!incoming) continue
    const current = release
      ? ((release[field as keyof ReleaseDetailDto] as string | null) ?? '')
      : ''
    head.push({
      field,
      label: label(),
      current: shown(field, current),
      incoming: shown(field, incoming),
      status: release ? statusOf(current, incoming) : 'new'
    })
  }

  const tracks: RowPlan[] = parsed.tracks.map((incoming) => {
    const match = release ? matchTrack(release.tracks, incoming) : null
    const compared = match ? compareTrack(match, incoming) : null
    return {
      key: incoming.key,
      label: incoming.title,
      detail: [normalizeCode(incoming.isrc), formatDuration(incoming.durationSeconds)]
        .filter(Boolean)
        .join(' · '),
      status: compared?.status ?? 'new',
      conflicts: compared?.conflicts ?? []
    }
  })

  const products: RowPlan[] = parsed.products.map((incoming, index) => {
    const match = release ? matchProduct(release.products, incoming) : null
    const compared = match && release ? compareProduct(match, incoming, release, parsed) : null
    return {
      key: `product:${index}`,
      label: productLabel(incoming),
      detail: [
        normalizeCode(incoming.upc),
        incoming.catalogNumber,
        incoming.releaseDate && germanDate(incoming.releaseDate)
      ]
        .filter(Boolean)
        .join(' · '),
      status: compared?.status ?? 'new',
      conflicts: compared?.conflicts ?? []
    }
  })

  const known = new Set((release?.credits ?? []).map(contributorKey))
  const added = parsed.credits.filter((c) => !known.has(contributorKey(c))).length

  const measures = new Set(existingMeasures.map(budgetKey))
  const budget: BudgetLinePlan[] = parsed.budget.map((line, index) => ({
    ...line,
    index,
    exists: measures.has(budgetKey(line))
  }))

  return { head, tracks, products, credits: { incoming: parsed.credits.length, added }, budget }
}

// ---------- the merge ----------

/** The release's head after the import: empty fields filled, `take` fields replaced */
export function mergeHead(
  release: ReleaseDetailDto | null,
  parsed: ParsedReleaseHead,
  take: readonly string[],
  bandId: number | null
): ReleaseFields {
  const pick = <K extends HeadField>(field: K): string | null => {
    const incoming = parsed[field] as string | null
    const current = release
      ? ((release[field as keyof ReleaseDetailDto] as string | null) ?? null)
      : null
    if (!incoming) return current
    if (!current) return incoming
    return take.includes(field) ? incoming : current
  }
  const text = (field: HeadField) => pick(field) ?? ''
  return {
    bandId: release ? release.bandId : bandId,
    artistName: text('artistName'),
    title: text('title') || t('Neues Release'),
    version: text('version'),
    releaseType: (pick('releaseType') as ReleaseFields['releaseType'] | null) ?? 'album',
    releaseDate: pick('releaseDate'),
    originalReleaseDate: pick('originalReleaseDate'),
    preorderD2cDate: pick('preorderD2cDate'),
    preorderRetailDate: pick('preorderRetailDate'),
    preorderDigitalDate: pick('preorderDigitalDate'),
    label: text('label'),
    catalogNumber: text('catalogNumber'),
    pLine: text('pLine'),
    cLine: text('cLine'),
    genre: text('genre'),
    subGenre: text('subGenre'),
    metadataLanguage: text('metadataLanguage'),
    recordingCountry: text('recordingCountry'),
    projectNumber: text('projectNumber'),
    notes: release?.notes ?? ''
  }
}

/** The release-wide credits: those already there, then the file's that are missing */
export function mergeCredits(
  current: ContributorDto[],
  incoming: ContributorInput[]
): ContributorInput[] {
  const kept: ContributorInput[] = current.map((c) => ({
    name: c.name,
    role: c.role,
    instrument: c.instrument,
    personId: c.personId
  }))
  const known = new Set(kept.map(contributorKey))
  for (const c of incoming) {
    const key = contributorKey(c)
    if (known.has(key)) continue
    known.add(key)
    kept.push(c)
  }
  return kept
}

const keepText = (current: string, incoming: string, overwrite: boolean) =>
  !incoming ? current : !current || overwrite ? incoming : current
function keep<T>(current: T | null, incoming: T | null, overwrite: boolean): T | null {
  return incoming === null ? current : current === null || overwrite ? incoming : current
}

function contributorsOf(list: ContributorDto[]): ContributorInput[] {
  return list.map((c) => ({
    name: c.name,
    role: c.role,
    instrument: c.instrument,
    personId: c.personId
  }))
}
function sharesOf(list: WorkShareDto[]): WorkShareInput[] {
  return list.map((s) => ({
    name: s.name,
    role: s.role,
    sharePercent: s.sharePercent,
    society: s.society,
    ipi: s.ipi,
    publisher: s.publisher,
    country: s.country,
    personId: s.personId
  }))
}

/**
 * A track after the import. A list (performers, writers) is taken from the file when the track
 * has none, or replaced on `overwrite`; a known writer without society or IPI gets them filled.
 */
export function mergeTrack(
  releaseId: number,
  current: TrackDto | null,
  incoming: ParsedTrack,
  overwrite: boolean
): SaveTrackData {
  const contributors =
    !current || current.contributors.length === 0 || (overwrite && incoming.contributors.length > 0)
      ? incoming.contributors
      : contributorsOf(current.contributors)
  let workShares: WorkShareInput[]
  if (!current || current.workShares.length === 0 || (overwrite && incoming.workShares.length > 0))
    workShares = incoming.workShares
  else {
    workShares = sharesOf(current.workShares).map((share) => {
      const from = incoming.workShares.find(
        (s) => keyText(s.name) === keyText(share.name) && s.role === share.role
      )
      if (!from) return share
      return {
        ...share,
        sharePercent: share.sharePercent ?? from.sharePercent,
        society: share.society || from.society,
        ipi: share.ipi || from.ipi,
        publisher: share.publisher || from.publisher,
        country: share.country || from.country
      }
    })
  }
  return {
    id: current?.id ?? null,
    releaseId,
    title: keepText(current?.title ?? '', incoming.title, overwrite),
    version: keepText(current?.version ?? '', incoming.version, overwrite),
    durationSeconds: keep(current?.durationSeconds ?? null, incoming.durationSeconds, overwrite),
    isrc: keepText(current?.isrc ?? '', normalizeCode(incoming.isrc), overwrite),
    explicit: keep(current ? current.explicit : null, incoming.explicit, overwrite) ?? false,
    genre: keepText(current?.genre ?? '', incoming.genre, overwrite),
    pLine: keepText(current?.pLine ?? '', incoming.pLine, overwrite),
    cLine: keepText(current?.cLine ?? '', incoming.cLine, overwrite),
    videoIsrc: keepText(current?.videoIsrc ?? '', normalizeCode(incoming.videoIsrc), overwrite),
    lyrics: keepText(current?.lyrics ?? '', incoming.lyrics, overwrite),
    notes: current?.notes ?? '',
    contributors,
    workShares
  }
}

/** A product after the import; the tracklist names the release's track ids */
export function mergeProduct(
  releaseId: number,
  current: ProductDto | null,
  incoming: ParsedProduct,
  trackIds: ReadonlyMap<string, number>,
  overwrite: boolean
): SaveProductData {
  const incomingTracks = incoming.tracks.flatMap((pt) => {
    const trackId = trackIds.get(pt.trackKey)
    return trackId === undefined ? [] : [{ trackId, disc: pt.disc, side: pt.side }]
  })
  const tracks =
    !current || current.tracks.length === 0 || (overwrite && incomingTracks.length > 0)
      ? incomingTracks
      : current.tracks.map((pt) => ({ trackId: pt.trackId, disc: pt.disc, side: pt.side }))
  const format = incoming.format === 'other' ? null : incoming.format
  return {
    id: current?.id ?? null,
    releaseId,
    format: (current ? (overwrite && format ? format : current.format) : format) ?? 'other',
    title: keepText(current?.title ?? '', incoming.title, overwrite),
    packaging: keepText(current?.packaging ?? '', incoming.packaging, overwrite),
    color: keepText(current?.color ?? '', incoming.color, overwrite),
    upc: keepText(current?.upc ?? '', normalizeCode(incoming.upc), overwrite),
    catalogNumber: keepText(current?.catalogNumber ?? '', incoming.catalogNumber, overwrite),
    territory: keepText(current?.territory ?? '', incoming.territory, overwrite),
    discCount: keep(current?.discCount ?? null, incoming.discCount, overwrite),
    releaseDate: keep(current?.releaseDate ?? null, incoming.releaseDate, overwrite),
    priceCode: keepText(current?.priceCode ?? '', incoming.priceCode, overwrite),
    boxLot: keep(current?.boxLot ?? null, incoming.boxLot, overwrite),
    notes: current?.notes ?? '',
    tracks
  }
}

/** The codes of a label copy, to find the release it belongs to */
export function labelCopyCodes(parsed: ParsedLabelCopy) {
  return {
    upcs: parsed.products.map((p) => normalizeCode(p.upc)).filter(Boolean),
    catalogNumbers: [parsed.head.catalogNumber, ...parsed.products.map((p) => p.catalogNumber)]
      .map((c) => c.trim())
      .filter(Boolean),
    isrcs: parsed.tracks.map((tr) => normalizeCode(tr.isrc)).filter(Boolean)
  }
}
