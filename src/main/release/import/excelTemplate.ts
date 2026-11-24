// ========================================
// A label copy as an Excel workbook (#289)
// ========================================
// Labels send their own templates: a sheet with the general info (artist, title, dates,
// credits, line-up, writers), one sheet per product (digipak, digital, vinyl …) with its codes
// and tracklist, optional lyrics and a budget sheet. The sheets are recognised by what is in
// them, not by their names, so a template in another order or language still reads. Pure.
import type { XlsxSheet } from '../../import/xlsx'
import type { ContributorInput, WorkShareInput } from '../../api/schemas/release.schema'
import type {
  ParsedBudgetLine,
  ParsedLabelCopy,
  ParsedProduct,
  ParsedReleaseHead,
  ParsedTrack
} from '../../api/schemas/release_import.schema'
import { normalizeCode } from '../codes'
import {
  clean,
  contributor,
  formatOf,
  keyText,
  parseAmountCents,
  parseCount,
  parseFlag,
  parseLooseDate,
  parseTrackDuration,
  releaseTypeOf,
  splitNames,
  trackKey,
  workShare
} from './values'

type Row = string[]

const cell = (row: Row | undefined, index: number) => clean(row?.[index])
/** The label in column A, upper case, without a trailing colon */
const labelOf = (row: Row | undefined) =>
  cell(row, 0)
    .toUpperCase()
    .replace(/[:\s]+$/, '')

/** Rows of "LABEL | value": the first match of a pattern, value from column B (or the next filled) */
function labelled(rows: Row[], pattern: RegExp): string {
  for (const row of rows) {
    if (!pattern.test(labelOf(row))) continue
    for (let i = 1; i < Math.min(row.length, 4); i++) if (cell(row, i)) return cell(row, i)
    return ''
  }
  return ''
}

/** Index of the first row holding all these header texts (case-insensitive), or -1 */
function headerRow(rows: Row[], ...names: RegExp[]): number {
  return rows.findIndex((row) => names.every((name) => row.some((c) => name.test(clean(c)))))
}

function columnOf(row: Row, pattern: RegExp): number {
  return row.findIndex((c) => pattern.test(clean(c)))
}

const EMPTY_HEAD: ParsedReleaseHead = {
  artistName: '',
  title: '',
  version: '',
  releaseType: null,
  releaseDate: null,
  originalReleaseDate: null,
  preorderD2cDate: null,
  preorderRetailDate: null,
  preorderDigitalDate: null,
  label: '',
  catalogNumber: '',
  pLine: '',
  cLine: '',
  genre: '',
  subGenre: '',
  metadataLanguage: '',
  recordingCountry: '',
  projectNumber: ''
}

/** Whether the workbook looks like a label copy: a sheet with a tracklist with ISRCs or titles */
export function isExcelLabelCopy(sheets: XlsxSheet[]): boolean {
  return sheets.some((sheet) => headerRow(sheet.records, /^track title$|^title$/i, /isrc/i) >= 0)
}

/** "℗ & © 2026" with the label -> the two lines; a line that names its owner stays as it is */
function copyrightLines(value: string, label: string): { pLine: string; cLine: string } {
  const text = clean(value)
  if (!text) return { pLine: '', cLine: '' }
  const year = /\b(19|20)\d{2}\b/.exec(text)?.[0] ?? ''
  const owner = text
    .replace(/℗|©|\(p\)|\(c\)|&|\b(19|20)\d{2}\b|\bp\b|\bc\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const who = owner || label
  const line = (mark: string) => [mark, year, who].filter(Boolean).join(' ')
  const hasP = /℗|\(p\)|\bp\b/i.test(text)
  const hasC = /©|\(c\)|\bc\b/i.test(text)
  return {
    pLine: hasP || !hasC ? line('℗') : '',
    cLine: hasC || !hasP ? line('©') : ''
  }
}

const CREDIT_ROWS: Array<[RegExp, string]> = [
  [/^PRODUCED/, 'Producer'],
  [/^CO-?PRODUCED/, 'Co-Producer'],
  [/^RECORDED/, 'Recording Engineer'],
  [/^MIXED/, 'Mixing Engineer'],
  [/^MASTERED/, 'Mastering Engineer'],
  [/^PHOTO/, 'Photography'],
  [/^ARTWORK|^COVER|^DESIGN/, 'Artwork']
]

/** The general info sheet: head, credits, line-up, guests and the writers' societies */
function readGeneral(rows: Row[]) {
  const label = labelled(rows, /^LABEL$/)
  const lines = copyrightLines(labelled(rows, /^C ?\+ ?P$|^P ?\+ ?C$|^©|^℗/), label)
  const head: ParsedReleaseHead = {
    ...EMPTY_HEAD,
    artistName: labelled(rows, /^(MAIN )?ARTIST$/),
    title: labelled(rows, /^(RELEASE |ALBUM )?TITLE$/),
    version: labelled(rows, /^VERSION$/),
    releaseDate: parseLooseDate(labelled(rows, /^RELEASE DATE$|^RELEASE$|^STREET DATE$/)),
    originalReleaseDate: parseLooseDate(labelled(rows, /^ORIGINAL RELEASE/)),
    preorderD2cDate: parseLooseDate(labelled(rows, /D2C PRE-?ORDER/)),
    preorderRetailDate: parseLooseDate(labelled(rows, /RETAIL PRE-?ORDER/)),
    preorderDigitalDate: parseLooseDate(labelled(rows, /DIGITAL PRE-?ORDER/)),
    label,
    catalogNumber: labelled(rows, /^CAT(ALOGUE|ALOG)?\.? ?NO\.?$|^CATALOG(UE)? NUMBER$/),
    pLine: labelled(rows, /^P[ -]?LINE$/) || lines.pLine,
    cLine: labelled(rows, /^C[ -]?LINE$/) || lines.cLine,
    genre: labelled(rows, /^(MAIN )?GENRE$/),
    subGenre: labelled(rows, /^SUB ?GENRE/),
    metadataLanguage: labelled(rows, /LANGUAGE/),
    recordingCountry: labelled(rows, /^RECORDING COUNTRY$/),
    projectNumber: labelled(rows, /^PROJECT ?(NO|NUMBER|#)/)
  }

  const credits: ContributorInput[] = []
  for (const row of rows) {
    const rowLabel = labelOf(row)
    const role = CREDIT_ROWS.find(([pattern]) => pattern.test(rowLabel))?.[1]
    if (!role) continue
    for (const name of splitNames(cell(row, 1))) credits.push(contributor(name, role))
  }

  // tables: a title row ("BAND MEMBERS | Name | Instrument(s)") and rows below until a gap
  const table = (title: RegExp): Row[] => {
    const start = rows.findIndex((row) => title.test(labelOf(row)))
    if (start < 0) return []
    const out: Row[] = []
    for (let i = start + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row.some((c) => clean(c))) {
        if (out.length > 0) break
        continue
      }
      // the next table's title row
      if (
        /^[A-Z /&+()-]{4,}$/.test(labelOf(row)) &&
        !/^(TEXTER|COMPOSER|LYRICIST)/.test(labelOf(row))
      )
        break
      out.push(row)
    }
    return out
  }
  for (const row of table(/^BAND MEMBERS|^LINE-?UP|^MEMBERS/)) {
    const name = cell(row, 1)
    if (name) credits.push(contributor(name, 'Band Member', cell(row, 2)))
  }
  const guests = table(/^GUESTS?/)
    .filter((row) => cell(row, 1))
    .map((row) => ({ name: cell(row, 1), instrument: cell(row, 2), track: cell(row, 3) }))
  const societies = new Map<string, { society: string; ipi: string }>()
  for (const row of table(/^COMPOSER|^WRITERS?|^TEXTER|^LYRICIST/)) {
    const name = cell(row, 1)
    if (name) societies.set(keyText(name), { society: cell(row, 2), ipi: cell(row, 3) })
  }
  return { head, credits, guests, societies }
}

type ProductSheet = {
  product: ParsedProduct
  /** Further products with the same tracklist (other colours, a jewel case) */
  variants: ParsedProduct[]
  tracks: ParsedTrack[]
  singles: Array<{
    upc: string
    catalogNumber: string
    title: string
    date: string | null
    videoIsrc: string
  }>
  publisherByKey: Map<string, string>
  composers: Map<string, { composers: string[]; lyricists: string[] }>
  shifted: boolean
  productType: string
}

function readProductSheet(sheet: XlsxSheet): ProductSheet | null {
  const rows = sheet.records
  const header = headerRow(rows, /^track title$|^title$/i, /isrc/i)
  if (header < 0) return null
  const head = rows.slice(0, header)
  const productType = labelled(head, /^PRODUCT TYPE$|^CONFIGURATION$|^FORMAT$/)
  const format = formatOf(`${sheet.sheetName} ${productType}`)
  const packaging =
    labelled(head, /^PACKAGING$/) ||
    (/digipa|jewel|mediabook|gatefold|ecopak/i.test(sheet.sheetName) ? sheet.sheetName.trim() : '')
  const product: ParsedProduct = {
    format,
    title: '',
    packaging,
    color: labelled(head, /^COLOU?R$/),
    upc: normalizeCode(labelled(head, /^UPC|^EAN$|^BARCODE/)),
    catalogNumber: labelled(head, /^CAT(ALOGUE|ALOG)?\.? ?NO\.?$|^CATALOG(UE)? NUMBER$/),
    territory: labelled(head, /^TERRITOR/),
    discCount: parseCount(labelled(head, /^DISCS?$|^NUMBER OF DISCS/)),
    releaseDate: parseLooseDate(labelled(head, /^RELEASE DATE$/)),
    priceCode: labelled(head, /^PC\b|^PRICE CODE/),
    boxLot: parseCount(labelled(head, /^BOX ?LOT$/)),
    tracks: []
  }

  const result: ProductSheet = {
    product,
    variants: [],
    tracks: [],
    singles: [],
    publisherByKey: new Map(),
    composers: new Map(),
    shifted: false,
    productType
  }

  // tracklists: each header row starts one (several discs), "CD 2" / "Disc 2" above it
  let columns: Record<string, number> | null = null
  let disc = 1
  let section: 'tracks' | 'singles' | 'colours' | null = null
  let sectionColumns: Record<string, number> = {}
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const first = labelOf(row)
    const discMatch = /^(CD|DISC|LP|VINYL|SIDE)\s*(\d+)$/.exec(first)
    if (discMatch) {
      disc = Number(discMatch[2])
      continue
    }
    if (
      row.some((c) => /^track title$|^title$/i.test(clean(c))) &&
      row.some((c) => /isrc/i.test(clean(c))) &&
      !/^UPC/.test(first)
    ) {
      columns = {
        no: columnOf(row, /^no\.?$|^#$|^track$/i),
        title: columnOf(row, /^track title$|^title$/i),
        version: columnOf(row, /version|featuring/i),
        composer: columnOf(row, /composer|komponist/i),
        lyricist: columnOf(row, /lyricist|texter|writer/i),
        duration: columnOf(row, /duration|length|dauer|time/i),
        isrc: columnOf(row, /isrc/i),
        publisher: columnOf(row, /publisher|verlag/i),
        explicit: columnOf(row, /explicit/i),
        side: columnOf(row, /side/i)
      }
      section = 'tracks'
      continue
    }
    if (/^SINGLES|^IGT|^FOCUS/.test(first)) {
      section = 'singles'
      const next = rows[i + 1] ?? []
      sectionColumns = {
        upc: columnOf(next, /^upc|^ean/i),
        cat: columnOf(next, /cat/i),
        title: columnOf(next, /title/i),
        date: columnOf(next, /date/i),
        video: columnOf(next, /video/i)
      }
      i++
      continue
    }
    if (/^OTHER COLOU?RS|^VARIANTS?|^COLOU?R VARIANTS/.test(first)) {
      section = 'colours'
      // column A holds the codes under the section's title
      const at = (pattern: RegExp) => {
        const index = row.slice(1).findIndex((c) => pattern.test(clean(c)))
        return index < 0 ? -1 : index + 1
      }
      sectionColumns = {
        cat: at(/cat/i),
        title: at(/^title$|^colou?r$|^name$/i),
        config: at(/config/i)
      }
      continue
    }
    // a further code of the same product: "EAN Jewelcase | 4255…"
    if (/^(EAN|UPC)\s+\S/.test(first) && /^\d{8,14}$/.test(normalizeCode(cell(row, 1)))) {
      const what = cell(row, 0).replace(/^(EAN|UPC)\s+/i, '')
      result.variants.push({
        ...product,
        format: formatOf(what) === 'other' ? product.format : formatOf(what),
        packaging: what,
        upc: normalizeCode(cell(row, 1)),
        catalogNumber: '',
        boxLot: null,
        tracks: []
      })
      continue
    }
    if (/^TOTAL/.test(first) || row.some((c) => /^total$/i.test(clean(c)))) {
      if (section === 'tracks') section = null
      continue
    }

    if (section === 'tracks' && columns) {
      const title = cell(row, columns.title)
      const isrc = normalizeCode(cell(row, columns.isrc))
      if (!title) continue
      const duration = parseTrackDuration(cell(row, columns.duration))
      result.shifted ||= duration.shifted
      const key = trackKey(isrc, title)
      result.tracks.push({
        key,
        title,
        version: cell(row, columns.version),
        durationSeconds: duration.seconds,
        isrc,
        explicit: columns.explicit >= 0 ? parseFlag(cell(row, columns.explicit)) : null,
        genre: '',
        pLine: '',
        cLine: '',
        videoIsrc: '',
        lyrics: '',
        contributors: [],
        workShares: []
      })
      result.composers.set(key, {
        composers: columns.composer >= 0 ? splitNames(cell(row, columns.composer)) : [],
        lyricists: columns.lyricist >= 0 ? splitNames(cell(row, columns.lyricist)) : []
      })
      const publisher = columns.publisher >= 0 ? cell(row, columns.publisher) : ''
      if (publisher) result.publisherByKey.set(key, publisher)
      product.tracks.push({
        trackKey: key,
        disc,
        side: columns.side >= 0 ? cell(row, columns.side).toUpperCase() : ''
      })
      continue
    }
    if (section === 'singles') {
      const title = cell(row, sectionColumns.title)
      if (!title) continue
      result.singles.push({
        upc: normalizeCode(cell(row, sectionColumns.upc)),
        catalogNumber: cell(row, sectionColumns.cat),
        title,
        date: parseLooseDate(cell(row, sectionColumns.date)),
        videoIsrc: normalizeCode(cell(row, sectionColumns.video))
      })
      continue
    }
    if (section === 'colours') {
      const upc = normalizeCode(cell(row, 0))
      const catalogNumber = cell(row, sectionColumns.cat)
      if (!upc && !catalogNumber) continue
      const name = [cell(row, sectionColumns.title), cell(row, sectionColumns.config)]
        .filter(Boolean)
        .join(' · ')
      result.variants.push({
        ...product,
        color: name || `Variante ${result.variants.filter((v) => v.color).length + 2}`,
        upc,
        catalogNumber,
        tracks: []
      })
    }
  }
  if (result.tracks.length === 0 && !product.upc && !product.catalogNumber) return null
  return result
}

/** Lyrics: one column per track ("Track 1", "Track 2" …), the text below */
function readLyrics(rows: Row[]): Map<number, string> {
  const lyrics = new Map<number, string>()
  const header = rows.findIndex((row) => row.some((c) => /^track\s*\d+$/i.test(clean(c))))
  if (header < 0) return lyrics
  rows[header].forEach((c, column) => {
    const number = /^track\s*(\d+)$/i.exec(clean(c))?.[1]
    if (!number) return
    const text = rows
      .slice(header + 1)
      .map((row) => (row[column] ?? '').trim())
      .join('\n')
      .trim()
    if (text) lyrics.set(Number(number), text)
  })
  return lyrics
}

/** The budget sheet: print, digital and PR/sales lines with a planned amount or marked done */
function readBudget(rows: Row[]): ParsedBudgetLine[] {
  const header = headerRow(rows, /projected|geplant|budget/i, /done|erledigt/i)
  if (header < 0) return []
  const titles = rows[header]
  const lines: ParsedBudgetLine[] = []
  // the sections side by side: each starts at a "Magazine", "Single"/"Platform" or "Action" column
  const sections: Array<{
    section: ParsedBudgetLine['section']
    start: number
    end: number
  }> = []
  titles.forEach((c, index) => {
    const text = clean(c)
    if (/magazine|print|medium/i.test(text))
      sections.push({ section: 'print', start: index, end: 0 })
    else if (/^single$|platform/i.test(text) && !sections.some((s) => s.section === 'digital'))
      sections.push({ section: 'digital', start: index, end: 0 })
    else if (/^action$|maßnahme|massnahme/i.test(text))
      sections.push({ section: 'pr', start: index, end: 0 })
  })
  sections.sort((a, b) => a.start - b.start)
  sections.forEach((s, i) => (s.end = sections[i + 1]?.start ?? titles.length))

  for (const { section, start, end } of sections) {
    const span = titles.slice(start, end).map((c) => clean(c))
    const at = (pattern: RegExp) => {
      const index = span.findIndex((c) => pattern.test(c))
      return index < 0 ? -1 : start + index
    }
    const cost = at(/projected|geplant|budget|cost|kosten/i)
    const done = at(/done|erledigt/i)
    for (const row of rows.slice(header + 1)) {
      if (row.some((c) => /^(full amount|remaining|total|summe)/i.test(clean(c)))) break
      const costCents = cost >= 0 ? parseAmountCents(cell(row, cost)) : null
      const isDone = done >= 0 ? parseFlag(cell(row, done)) === true : false
      // template rows (a magazine or platform named, nothing planned) are left out
      if ((costCents === null || costCents === 0) && !isDone) continue
      let title = ''
      let notes = ''
      if (section === 'print') {
        const magazine = cell(row, start)
        const size = cell(row, at(/size|größe|format/i))
        title = magazine ? `Anzeige ${magazine}` : 'Anzeige'
        notes = size ? `Größe: ${size}` : ''
      } else if (section === 'digital') {
        const single = cell(row, at(/^single$/i))
        const platform = cell(row, at(/platform/i))
        const timeframe = cell(row, at(/timeframe|zeitraum/i))
        title = [platform || 'Online', single && `„${single}“`].filter(Boolean).join(' ')
        notes = timeframe ? `Zeitraum: ${timeframe}` : ''
      } else {
        title = cell(row, start) || 'PR / Sales'
      }
      lines.push({
        section,
        kind: section === 'print' ? 'print_ad' : section === 'digital' ? 'online_ad' : 'other',
        title,
        costCents: costCents && costCents > 0 ? costCents : null,
        done: isDone,
        notes
      })
    }
  }
  return lines
}

/** Fills the empty fields of `into` from `from` (the same track in another product sheet) */
function mergeTrack(into: ParsedTrack, from: ParsedTrack) {
  into.version ||= from.version
  into.durationSeconds ??= from.durationSeconds
  into.isrc ||= from.isrc
  if (into.explicit === null) into.explicit = from.explicit
}

export function parseExcelLabelCopy(sheets: XlsxSheet[]): ParsedLabelCopy | null {
  if (!isExcelLabelCopy(sheets)) return null
  const warnings: string[] = []
  const generalSheet = sheets.find(
    (sheet) =>
      labelled(sheet.records, /^(MAIN )?ARTIST$/) &&
      labelled(sheet.records, /^(RELEASE |ALBUM )?TITLE$/)
  )
  const general = generalSheet
    ? readGeneral(generalSheet.records)
    : { head: { ...EMPTY_HEAD }, credits: [], guests: [], societies: new Map() }

  const productSheets = sheets
    .map((sheet) => readProductSheet(sheet))
    .filter((sheet): sheet is ProductSheet => sheet !== null)

  // the tracks of all products, once each (by ISRC, else title)
  const tracks: ParsedTrack[] = []
  const byKey = new Map<string, ParsedTrack>()
  const byTitle = new Map<string, ParsedTrack>()
  const writers = new Map<string, { composers: string[]; lyricists: string[] }>()
  const publishers = new Map<string, string>()
  for (const sheet of productSheets) {
    for (const track of sheet.tracks) {
      const known = byKey.get(track.key) ?? byTitle.get(keyText(track.title))
      if (known) {
        mergeTrack(known, track)
        // a product names the track by the key the release keeps
        for (const pt of sheet.product.tracks)
          if (pt.trackKey === track.key) pt.trackKey = known.key
      } else {
        tracks.push(track)
        byKey.set(track.key, track)
        byTitle.set(keyText(track.title), track)
      }
      const target = known ?? track
      const names = sheet.composers.get(track.key)
      const current = writers.get(target.key)
      if (names && (!current || current.composers.length + current.lyricists.length === 0))
        writers.set(target.key, names)
      const publisher = sheet.publisherByKey.get(track.key)
      if (publisher && !publishers.has(target.key)) publishers.set(target.key, publisher)
    }
  }
  if (productSheets.some((sheet) => sheet.shifted))
    warnings.push(
      'Die Dauern standen als Stunden:Minuten in der Datei und wurden als Minuten:Sekunden gelesen.'
    )

  // writers: one share per name and part, without percentages (the template has none)
  for (const track of tracks) {
    const names = writers.get(track.key)
    if (!names) continue
    const publisher = publishers.get(track.key) ?? ''
    const shares: WorkShareInput[] = []
    const add = (name: string, role: WorkShareInput['role']) => {
      const known = general.societies.get(keyText(name))
      shares.push(
        workShare(name, role, {
          society: known?.society ?? '',
          ipi: known?.ipi ?? '',
          publisher
        })
      )
    }
    names.lyricists.forEach((name) => add(name, 'lyricist'))
    names.composers.forEach((name) => add(name, 'composer'))
    track.workShares = shares
  }

  // the performers: the artist on every track, guests where they play
  const artist = general.head.artistName
  for (const track of tracks)
    if (artist) track.contributors.push(contributor(artist, 'Primary Artist'))
  for (const guest of general.guests) {
    const number = /^\d+$/.test(guest.track) ? Number(guest.track) : null
    const targets = guest.track
      ? tracks.filter(
          (track, index) =>
            (number !== null && index + 1 === number) ||
            keyText(track.title) === keyText(guest.track)
        )
      : tracks
    for (const track of targets)
      track.contributors.push(contributor(guest.name, 'Guest Musician', guest.instrument))
  }

  // lyrics by track number
  for (const sheet of sheets) {
    const lyrics = readLyrics(sheet.records)
    for (const [number, text] of lyrics) if (tracks[number - 1]) tracks[number - 1].lyrics = text
  }

  // products: each sheet's own, its variants with the same tracklist, the singles
  const products: ParsedProduct[] = []
  for (const sheet of productSheets) {
    products.push(sheet.product)
    for (const variant of sheet.variants)
      products.push({ ...variant, tracks: sheet.product.tracks.map((pt) => ({ ...pt })) })
    for (const single of sheet.singles) {
      const track = byTitle.get(keyText(single.title))
      if (track && single.videoIsrc && !track.videoIsrc) track.videoIsrc = single.videoIsrc
      if (!single.upc && !single.catalogNumber) continue
      products.push({
        format: 'digital',
        title: `Single „${single.title}“`,
        packaging: '',
        color: '',
        upc: single.upc,
        catalogNumber: single.catalogNumber,
        territory: sheet.product.territory,
        discCount: null,
        releaseDate: single.date,
        priceCode: '',
        boxLot: null,
        tracks: track ? [{ trackKey: track.key, disc: 1, side: '' }] : []
      })
      if (!track) warnings.push(`Single „${single.title}“: kein Track mit diesem Titel gefunden.`)
    }
  }

  const head = { ...general.head }
  const digital = productSheets.find((sheet) => sheet.product.format === 'digital')
  head.releaseType =
    releaseTypeOf(digital?.productType ?? '') ??
    (tracks.length === 0
      ? null
      : tracks.length <= 3
        ? 'single'
        : tracks.length <= 7
          ? 'ep'
          : 'album')
  if (!head.title && tracks.length === 1) head.title = tracks[0].title

  const budgetSheet = sheets.find(
    (sheet) => headerRow(sheet.records, /projected|budget/i, /done/i) >= 0
  )
  return {
    source: 'excel',
    head,
    credits: general.credits,
    tracks,
    products,
    budget: budgetSheet ? readBudget(budgetSheet.records) : [],
    warnings
  }
}
