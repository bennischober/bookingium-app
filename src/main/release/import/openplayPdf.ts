// ========================================
// A label copy report from OpenPlay as PDF text (#289)
// ========================================
// The distributor's report ("Label Copy", one release): the release fields as "Label: value",
// then per disc the tracks ("<title>" / "Track 1   3:22") with their fields, performers and the
// work's contributions (name, role, affiliation, split, country). Cells of a line are separated
// by runs of spaces in the extracted text; page headers and footers run through it. Pure.
import type { ContributorInput } from '../../api/schemas/release.schema'
import type {
  ParsedLabelCopy,
  ParsedProduct,
  ParsedReleaseHead,
  ParsedTrack
} from '../../api/schemas/release_import.schema'
import { normalizeCode } from '../codes'
import {
  clean,
  contributor,
  contributorRole,
  formatOf,
  parseLooseDate,
  parsePercent,
  parseTrackDuration,
  releaseTypeOf,
  trackKey,
  workRoles,
  workShare
} from './values'

/** Whether a PDF's text is such a report */
export function isOpenPlayLabelCopy(text: string): boolean {
  return /Label Copy/.test(text) && /Release Number:|Primary Release Date:/.test(text)
}

const FIELD = /^([A-Za-z][A-Za-z #/]*?):(?:\s+(.*))?$/
const TRACK = /^Track\s+(\d+)(?:\s+(\d+:\d{2}(?::\d{2})?))?$/
const DISC = /^Disc\s+(\d+)$/
const SPLIT = /^\d{1,3}(?:[.,]\d+)?\s?%$/

/** Lines of the report without the page header and footer */
function reportLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '')
    .filter((line) => !/\|\s*Page \d+ of \d+/.test(line) && !/^\s*Reported By:/.test(line))
    .map((line) => line.trim())
}

const cellsOf = (line: string) => line.split(/\s{2,}/).map((part) => part.trim())

function field(line: string): { name: string; value: string } | null {
  if (TRACK.test(line)) return null
  const match = FIELD.exec(line)
  if (!match) return null
  return { name: match[1].trim().toLowerCase(), value: clean(match[2]) }
}

export function parseOpenPlayLabelCopy(text: string): ParsedLabelCopy | null {
  if (!isOpenPlayLabelCopy(text)) return null
  const lines = reportLines(text)
  const warnings: string[] = []

  const firstTrack = lines.findIndex((line) => TRACK.test(line) || DISC.test(line))
  const headLines = lines.slice(0, firstTrack < 0 ? lines.length : firstTrack)
  const values = new Map<string, string>()
  headLines.forEach((line, index) => {
    const f = field(line)
    if (!f) return
    // "Primary Release Date:" has its value on the next line
    const value =
      f.value ||
      (headLines[index + 1] && !field(headLines[index + 1]) ? clean(headLines[index + 1]) : '')
    if (!values.has(f.name)) values.set(f.name, value)
  })
  const durationAt = headLines.findIndex((line) => /^Duration:/.test(line))
  const title = durationAt > 0 ? clean(headLines[durationAt - 1]) : ''
  const get = (name: string) => values.get(name) ?? ''
  const configuration = get('configuration')

  const head: ParsedReleaseHead = {
    artistName: get('main artist'),
    title,
    version: get('version'),
    releaseType: releaseTypeOf(configuration),
    releaseDate: parseLooseDate(get('primary release date')),
    originalReleaseDate: null,
    preorderD2cDate: null,
    preorderRetailDate: null,
    preorderDigitalDate: null,
    label: get('label'),
    catalogNumber: get('release number'),
    pLine: get('p line'),
    cLine: get('c line'),
    genre: get('genre'),
    subGenre: '',
    metadataLanguage: '',
    recordingCountry: '',
    projectNumber: get('project #')
  }
  const reissue = parseLooseDate(get('reissue date'))
  if (reissue && head.releaseDate) {
    // the report's primary date is the first release, the re-issue the one this copy is for
    head.originalReleaseDate = head.releaseDate
    head.releaseDate = reissue
  }

  // ---------- tracks ----------
  const tracks: ParsedTrack[] = []
  const placements: ParsedProduct['tracks'] = []
  let disc = 1
  let current: ParsedTrack | null = null
  let block: 'fields' | 'contributors' | 'contributions' = 'fields'
  let shifted = false

  const finish = () => {
    if (current) tracks.push(current)
    current = null
  }

  for (let i = firstTrack < 0 ? lines.length : firstTrack; i < lines.length; i++) {
    const line = lines[i]
    const discMatch = DISC.exec(line)
    if (discMatch) {
      disc = Number(discMatch[1])
      continue
    }
    const trackMatch = TRACK.exec(line)
    if (trackMatch) {
      // the title is the line above; drop it from the previous track's last block
      finish()
      const titleLine = lines[i - 1] ?? ''
      const duration = parseTrackDuration(trackMatch[2] ?? '')
      shifted ||= duration.shifted
      current = {
        key: '',
        title: clean(titleLine),
        version: '',
        durationSeconds: duration.seconds,
        isrc: '',
        explicit: null,
        genre: '',
        pLine: '',
        cLine: '',
        videoIsrc: '',
        lyrics: '',
        contributors: [],
        workShares: []
      }
      placements.push({ trackKey: '', disc, side: '' })
      block = 'fields'
      continue
    }
    if (!current) continue
    const track: ParsedTrack = current
    const f = field(line)
    if (f && f.name === 'contributors') {
      block = 'contributors'
      continue
    }
    if (f && f.name === 'contributions') {
      block = 'contributions'
      continue
    }
    if (f && f.name !== 'work') {
      block = 'fields'
      switch (f.name) {
        case 'version':
          track.version = f.value
          break
        case 'isrc':
          track.isrc = normalizeCode(f.value)
          break
        case 'genre':
          track.genre = f.value === head.genre ? '' : f.value
          break
        case 'p line':
          track.pLine = f.value === head.pLine ? '' : f.value
          break
        case 'c line':
          track.cLine = f.value === head.cLine ? '' : f.value
          break
        case 'flags':
          if (/explicit/i.test(f.value)) track.explicit = true
          else if (/clean/i.test(f.value)) track.explicit = false
          break
      }
      continue
    }
    if (f) continue // Work: <title>
    const cells = cellsOf(line)
    if (block === 'contributors') {
      if (cells.length >= 2) {
        const role = contributorRole(cells[cells.length - 1])
        track.contributors.push(contributor(cells.slice(0, -1).join(' '), role))
      }
      continue
    }
    if (block === 'contributions') {
      const splitAt = cells.findIndex((c) => SPLIT.test(c))
      if (splitAt < 2) continue // the next track's title, or a row without a share
      const [name, roleText] = cells
      const affiliation = cells.slice(2, splitAt).join(' ')
      const country = cells.slice(splitAt + 1).join(' ')
      const sharePercent = parsePercent(cells[splitAt])
      for (const role of workRoles(roleText))
        track.workShares.push(
          workShare(name, role, { sharePercent, society: affiliation, country })
        )
    }
  }
  finish()

  tracks.forEach((track, index) => {
    track.key = trackKey(track.isrc, track.title)
    placements[index].trackKey = track.key
  })
  if (shifted)
    warnings.push(
      'Eine Dauer war länger als ein Track sein kann und wurde als Minuten:Sekunden gelesen.'
    )

  const credits: ContributorInput[] = []
  const product: ParsedProduct = {
    format: formatOf(configuration) === 'other' ? 'digital' : formatOf(configuration),
    title: '',
    packaging: '',
    color: '',
    upc: normalizeCode(get('upc')),
    catalogNumber: head.catalogNumber,
    territory: get('territory'),
    discCount: disc > 1 ? disc : null,
    releaseDate: null,
    priceCode: '',
    boxLot: null,
    tracks: placements
  }
  if (!head.releaseType)
    head.releaseType =
      tracks.length === 0
        ? null
        : tracks.length <= 3
          ? 'single'
          : tracks.length <= 7
            ? 'ep'
            : 'album'
  if (tracks.length === 0) warnings.push('Im Report wurden keine Tracks gefunden.')

  return {
    source: 'openplay',
    head,
    credits,
    tracks,
    products: product.upc || product.catalogNumber || tracks.length > 0 ? [product] : [],
    budget: [],
    warnings
  }
}
