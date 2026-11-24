// #289: the editing state of the release dialogs
import { describe, it, expect } from 'vitest'
import {
  moveItem,
  parseShare,
  productDraft,
  productInput,
  productWarnings,
  trackDraft,
  trackInput,
  trackWarnings
} from '../src/renderer/src/components/release/releaseDrafts'
import { totalDuration } from '../src/renderer/src/components/release/releaseText'
import type { ProductDto, TrackDto } from '../src/main/api/schemas/release.schema'

const track = (id: number, over: Partial<TrackDto> = {}): TrackDto => ({
  id,
  releaseId: 1,
  position: id,
  title: `Song ${id}`,
  version: '',
  durationSeconds: 200,
  isrc: '',
  explicit: false,
  genre: '',
  pLine: '',
  cLine: '',
  videoIsrc: '',
  lyrics: '',
  notes: '',
  contributors: [],
  workShares: [],
  ...over
})

describe('track drafts', () => {
  it('round-trips a track and drops rows without a name', () => {
    const draft = trackDraft(
      track(7, {
        durationSeconds: 202,
        workShares: [
          {
            id: 1,
            name: 'Erika Muster',
            role: 'composer',
            sharePercent: 33.3,
            society: 'GEMA',
            ipi: '',
            publisher: '',
            country: ''
          }
        ]
      })
    )
    expect(draft.duration).toBe('3:22')
    expect(draft.workShares[0].share).toBe('33,3')
    draft.contributors.push({ name: '  ', role: 'Producer', instrument: '' })
    const result = trackInput(1, 7, draft)
    if ('error' in result) throw new Error(result.error)
    expect(result.input.durationSeconds).toBe(202)
    expect(result.input.workShares?.[0].sharePercent).toBe(33.3)
    expect(result.input.contributors).toEqual([])
  })

  it('refuses a missing title, a bad duration and a bad share', () => {
    expect(trackInput(1, null, { ...trackDraft(null), title: '' })).toHaveProperty('error')
    expect(
      trackInput(1, null, { ...trackDraft(null), title: 'X', duration: '3 Minuten' })
    ).toHaveProperty('error')
    const draft = trackDraft(null)
    draft.title = 'X'
    draft.workShares = [
      {
        name: 'Max Beispiel',
        role: 'composer',
        share: '120',
        society: '',
        ipi: '',
        publisher: '',
        country: ''
      }
    ]
    expect(trackInput(1, null, draft)).toHaveProperty('error')
  })

  it('warns about codes and shares without blocking', () => {
    const draft = trackDraft(null)
    draft.isrc = 'nicht gültig'
    draft.workShares = [
      {
        name: 'A',
        role: 'composer',
        share: '50',
        society: '',
        ipi: '',
        publisher: '',
        country: ''
      },
      {
        name: 'B',
        role: 'composer',
        share: '25',
        society: '',
        ipi: '',
        publisher: '',
        country: ''
      },
      {
        name: 'C',
        role: 'lyricist',
        share: '100',
        society: '',
        ipi: '',
        publisher: '',
        country: ''
      }
    ]
    const warnings = trackWarnings(draft)
    expect(warnings).toHaveLength(2)
    expect(warnings[1]).toContain('75')
  })

  it('reads shares the German way', () => {
    expect(parseShare('33,3')).toBe(33.3)
    expect(parseShare('25 %')).toBe(25)
    expect(parseShare('')).toBe(null)
    expect(parseShare('viel')).toBe(undefined)
  })
})

describe('product drafts', () => {
  const tracks = [track(1), track(2), track(3)]

  it('offers all tracks to a new product, included', () => {
    const draft = productDraft(null, tracks)
    expect(draft.tracks.map((t) => [t.trackId, t.included])).toEqual([
      [1, true],
      [2, true],
      [3, true]
    ])
  })

  it('keeps an existing product order first, the rest unchecked after it', () => {
    const product: ProductDto = {
      id: 9,
      releaseId: 1,
      position: 1,
      format: 'vinyl',
      title: '',
      packaging: '',
      color: '',
      upc: '',
      catalogNumber: '',
      territory: '',
      discCount: null,
      releaseDate: null,
      priceCode: '',
      boxLot: null,
      notes: '',
      tracks: [
        { trackId: 3, position: 1, disc: 1, side: 'A' },
        { trackId: 1, position: 2, disc: 1, side: 'B' }
      ]
    }
    const draft = productDraft(product, tracks)
    expect(draft.tracks.map((t) => [t.trackId, t.included, t.side])).toEqual([
      [3, true, 'A'],
      [1, true, 'B'],
      [2, false, '']
    ])
    draft.tracks[1].side = 'b'
    const result = productInput(1, 9, draft)
    if ('error' in result) throw new Error(result.error)
    expect(result.input.tracks).toEqual([
      { trackId: 3, disc: 1, side: 'A' },
      { trackId: 1, disc: 1, side: 'B' }
    ])
  })

  it('checks numbers and the UPC', () => {
    const draft = productDraft(null, [])
    expect(productInput(1, null, { ...draft, discCount: 'zwei' })).toHaveProperty('error')
    expect(productWarnings({ ...draft, upc: '4006381333932' })).toHaveLength(1)
    expect(productWarnings({ ...draft, upc: '4006381333931' })).toEqual([])
  })
})

describe('helpers', () => {
  it('moves list items within bounds', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
  })

  it('totals known durations', () => {
    expect(totalDuration([{ durationSeconds: 100 }, { durationSeconds: null }])).toBe(100)
    expect(totalDuration([{ durationSeconds: null }])).toBeNull()
  })
})

describe('label copy import texts and marketing totals', () => {
  it('sums the import result in one line', async () => {
    const { importSummary } = await import('../src/renderer/src/components/release/labelCopyImport')
    expect(
      importSummary({
        releaseId: 1,
        created: true,
        tracksAdded: 2,
        tracksUpdated: 1,
        productsAdded: 1,
        productsUpdated: 0,
        measuresAdded: 2,
        documentStored: true
      })
    ).toBe('Tracks: 2 neu, 1 ergänzt · Produkt: 1 neu · 2 Maßnahmen · Datei abgelegt')
  })

  it('keeps what others pay (the label) out of our own marketing cost', async () => {
    const { costTotals } =
      await import('../src/renderer/src/components/band/marketing/marketingFilters')
    const action = (payer: string, costCents: number | null, status = 'planned') =>
      ({ payer, costCents, status }) as never
    expect(
      costTotals([
        action('us', 10000),
        action('label', 80000),
        action('band', 500),
        action('us', 3000, 'cancelled'),
        action('us', null)
      ])
    ).toEqual({ own: 10000, external: 80500 })
  })
})
