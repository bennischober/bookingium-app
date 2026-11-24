import type {
  ContributorDto,
  ContributorInput,
  ProductDto,
  ReleaseFormat,
  SaveProductInput,
  SaveTrackInput,
  TrackDto,
  WorkRole,
  WorkShareDto,
  WorkShareInput
} from '../../../../main/api/schemas/release.schema'
import {
  formatDuration,
  isValidGtin,
  isValidIsrc,
  parseDuration,
  shareTotals
} from '../../../../main/release/codes'
import { parseAmount } from '@/lib/invoiceLabels'
import { t } from '../../../../main/i18n/translate'

// The editing state of the release dialogs (#289): what the inputs hold, how it becomes the
// API input, and the hints shown while typing. Pure, so vitest covers it.

export type ContributorDraft = { name: string; role: string; instrument: string }

export type WorkShareDraft = {
  name: string
  role: WorkRole
  /** As typed: "33,3" */
  share: string
  society: string
  ipi: string
  publisher: string
  country: string
}

export type TrackDraft = {
  title: string
  version: string
  /** As typed: "3:22" */
  duration: string
  isrc: string
  explicit: boolean
  genre: string
  pLine: string
  cLine: string
  videoIsrc: string
  lyrics: string
  notes: string
  contributors: ContributorDraft[]
  workShares: WorkShareDraft[]
}

export type ProductTrackDraft = { trackId: number; included: boolean; disc: string; side: string }

export type ProductDraft = {
  format: ReleaseFormat
  title: string
  packaging: string
  color: string
  upc: string
  catalogNumber: string
  territory: string
  discCount: string
  releaseDate: string
  priceCode: string
  boxLot: string
  notes: string
  tracks: ProductTrackDraft[]
}

export const emptyContributor = (): ContributorDraft => ({ name: '', role: '', instrument: '' })

export const emptyWorkShare = (): WorkShareDraft => ({
  name: '',
  role: 'composer',
  share: '',
  society: '',
  ipi: '',
  publisher: '',
  country: ''
})

export function contributorDrafts(list: ContributorDto[]): ContributorDraft[] {
  return list.map((c) => ({ name: c.name, role: c.role, instrument: c.instrument }))
}

/** Rows without a name are dropped: an empty row left in the editor means nothing */
export function contributorInputs(list: ContributorDraft[]): ContributorInput[] {
  return list
    .filter((c) => c.name.trim())
    .map((c) => ({
      name: c.name.trim(),
      role: c.role.trim(),
      instrument: c.instrument.trim(),
      personId: null
    }))
}

function formatShare(value: number | null): string {
  if (value === null) return ''
  return String(value).replace('.', ',')
}

function workShareDrafts(list: WorkShareDto[]): WorkShareDraft[] {
  return list.map((s) => ({
    name: s.name,
    role: s.role,
    share: formatShare(s.sharePercent),
    society: s.society,
    ipi: s.ipi,
    publisher: s.publisher,
    country: s.country
  }))
}

/** A share as typed; undefined when it is no number from 0 to 100 */
export function parseShare(text: string): number | null | undefined {
  const value = text.replace('%', '').trim()
  if (!value) return null
  const number = parseAmount(value)
  if (number === null || !Number.isFinite(number) || number < 0 || number > 100) return undefined
  return number
}

export function trackDraft(track: TrackDto | null): TrackDraft {
  return {
    title: track?.title ?? '',
    version: track?.version ?? '',
    duration: formatDuration(track?.durationSeconds ?? null),
    isrc: track?.isrc ?? '',
    explicit: track?.explicit ?? false,
    genre: track?.genre ?? '',
    pLine: track?.pLine ?? '',
    cLine: track?.cLine ?? '',
    videoIsrc: track?.videoIsrc ?? '',
    lyrics: track?.lyrics ?? '',
    notes: track?.notes ?? '',
    contributors: contributorDrafts(track?.contributors ?? []),
    workShares: workShareDrafts(track?.workShares ?? [])
  }
}

/** The track as the API takes it, or the first problem that keeps it from being saved */
export function trackInput(
  releaseId: number,
  id: number | null,
  draft: TrackDraft
): { input: SaveTrackInput } | { error: string } {
  if (!draft.title.trim()) return { error: t('Bitte einen Titel angeben') }
  const durationSeconds = parseDuration(draft.duration)
  if (durationSeconds === undefined)
    return { error: t('Die Dauer bitte als Minuten:Sekunden angeben, z. B. 3:22') }
  const workShares: WorkShareInput[] = []
  for (const share of draft.workShares) {
    if (!share.name.trim()) continue
    const sharePercent = parseShare(share.share)
    if (sharePercent === undefined)
      return {
        error: t('Der Anteil von {{name}} ist keine Zahl von 0 bis 100', {
          name: share.name.trim()
        })
      }
    workShares.push({
      name: share.name.trim(),
      role: share.role,
      sharePercent,
      society: share.society.trim(),
      ipi: share.ipi.trim(),
      publisher: share.publisher.trim(),
      country: share.country.trim(),
      personId: null
    })
  }
  return {
    input: {
      id,
      releaseId,
      title: draft.title.trim(),
      version: draft.version.trim(),
      durationSeconds,
      isrc: draft.isrc.trim(),
      explicit: draft.explicit,
      genre: draft.genre.trim(),
      pLine: draft.pLine.trim(),
      cLine: draft.cLine.trim(),
      videoIsrc: draft.videoIsrc.trim(),
      lyrics: draft.lyrics,
      notes: draft.notes.trim(),
      contributors: contributorInputs(draft.contributors),
      workShares
    }
  }
}

/** Hints that do not block saving: a code that fails its check, shares that do not add up */
export function trackWarnings(draft: TrackDraft): string[] {
  const warnings: string[] = []
  if (draft.isrc.trim() && !isValidIsrc(draft.isrc))
    warnings.push(t('Der ISRC hat nicht die übliche Form (z. B. DE-XXX-26-00001).'))
  if (draft.videoIsrc.trim() && !isValidIsrc(draft.videoIsrc))
    warnings.push(t('Der Video-ISRC hat nicht die übliche Form.'))
  const totals = shareTotals(
    draft.workShares
      .filter((s) => s.name.trim())
      .map((s) => ({ role: s.role, sharePercent: parseShare(s.share) ?? null }))
  )
  for (const [role, total] of totals)
    if (Math.abs(total - 100) > 0.01)
      warnings.push(
        t('Die Anteile für {{role}} ergeben {{total}} % statt 100 %.', {
          role: roleName(role),
          total: formatShare(Math.round(total * 100) / 100)
        })
      )
  return warnings
}

function roleName(role: string): string {
  switch (role) {
    case 'lyricist':
      return t('Text')
    case 'composer':
      return t('Musik')
    case 'arranger':
      return t('Bearbeitung')
    default:
      return t('Sonstiges')
  }
}

/** The product's tracklist offers every track of the release, in the product's order first */
export function productDraft(product: ProductDto | null, tracks: TrackDto[]): ProductDraft {
  const listed = product?.tracks ?? []
  const byTrack = new Map(listed.map((pt) => [pt.trackId, pt]))
  const order = [
    ...listed.map((pt) => pt.trackId).filter((id) => tracks.some((tr) => tr.id === id)),
    ...tracks.map((tr) => tr.id).filter((id) => !byTrack.has(id))
  ]
  return {
    format: product?.format ?? 'digital',
    title: product?.title ?? '',
    packaging: product?.packaging ?? '',
    color: product?.color ?? '',
    upc: product?.upc ?? '',
    catalogNumber: product?.catalogNumber ?? '',
    territory: product?.territory ?? '',
    discCount: product?.discCount ? String(product.discCount) : '',
    releaseDate: product?.releaseDate ?? '',
    priceCode: product?.priceCode ?? '',
    boxLot: product?.boxLot ? String(product.boxLot) : '',
    notes: product?.notes ?? '',
    // a new product takes all tracks; an existing one keeps its own list
    tracks: order.map((trackId) => {
      const pt = byTrack.get(trackId)
      return {
        trackId,
        included: product ? Boolean(pt) : true,
        disc: String(pt?.disc ?? 1),
        side: pt?.side ?? ''
      }
    })
  }
}

function positiveInt(text: string): number | null | undefined {
  const value = text.trim()
  if (!value) return null
  if (!/^\d+$/.test(value) || Number(value) < 1) return undefined
  return Number(value)
}

export function productInput(
  releaseId: number,
  id: number | null,
  draft: ProductDraft
): { input: SaveProductInput } | { error: string } {
  const discCount = positiveInt(draft.discCount)
  if (discCount === undefined) return { error: t('Die Anzahl der Discs ist keine Zahl') }
  const boxLot = positiveInt(draft.boxLot)
  if (boxLot === undefined) return { error: t('Die Box Lot ist keine Zahl') }
  const tracks: SaveProductInput['tracks'] = []
  for (const track of draft.tracks) {
    if (!track.included) continue
    const disc = positiveInt(track.disc)
    if (disc === undefined) return { error: t('Die Disc-Nummer ist keine Zahl') }
    tracks.push({ trackId: track.trackId, disc: disc ?? 1, side: track.side.trim().toUpperCase() })
  }
  return {
    input: {
      id,
      releaseId,
      format: draft.format,
      title: draft.title.trim(),
      packaging: draft.packaging.trim(),
      color: draft.color.trim(),
      upc: draft.upc.trim(),
      catalogNumber: draft.catalogNumber.trim(),
      territory: draft.territory.trim(),
      discCount,
      releaseDate: draft.releaseDate || null,
      priceCode: draft.priceCode.trim(),
      boxLot,
      notes: draft.notes.trim(),
      tracks
    }
  }
}

export function productWarnings(draft: ProductDraft): string[] {
  return draft.upc.trim() && !isValidGtin(draft.upc)
    ? [t('Die UPC/EAN hat keine gültige Prüfziffer.')]
    : []
}

/** Moves the entry at `index` one up or down; out of range leaves the list as it is */
export function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const to = index + direction
  if (to < 0 || to >= list.length) return list
  const copy = [...list]
  ;[copy[index], copy[to]] = [copy[to], copy[index]]
  return copy
}
