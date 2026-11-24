// #289: releases with products, tracks, credits and work shares (the label copy)
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { setupTestDb, getTestDb } from './helpers/setup'
import { ReleaseService } from '../src/main/services/ReleaseService'
import { BandService } from '../src/main/services/BandService'
import { CompanyService } from '../src/main/services/CompanyService'
import { CreateCompanyInput } from '../src/main/api/schemas/company.schema'
import {
  CreateReleaseInput,
  SaveProductInput,
  SaveTrackInput,
  UpdateReleaseInput
} from '../src/main/api/schemas/release.schema'
import { ReleaseMapper } from '../src/main/api/mappers/release.mapper'
import { schema } from '../src/main/db/schema'
import { keyOf } from '../src/main/sync/merge'
import {
  formatDuration,
  isValidGtin,
  isValidIsrc,
  normalizeCode,
  parseDuration,
  shareTotals
} from '../src/main/release/codes'

setupTestDb()

const service = () => container.resolve(ReleaseService)
const db = () => getTestDb().db

async function band(name: string) {
  const owner = await container
    .resolve(CompanyService)
    .createCompany(CreateCompanyInput.parse({ name: `${name} GmbH` }))
  return container
    .resolve(BandService)
    .createBand({ name, companyId: owner.id, genre: '', notes: '' })
}

async function release(over: object = {}) {
  return service().create(CreateReleaseInput.parse({ title: 'Probealbum', ...over }))
}

describe('codes', () => {
  it('checks UPC/EAN check digits and ISRC shape', () => {
    expect(isValidGtin('4006381333931')).toBe(true)
    expect(isValidGtin('4006381333932')).toBe(false)
    expect(isValidGtin('036000291452')).toBe(true)
    expect(isValidGtin('12345')).toBe(false)
    expect(isValidIsrc('DE-XX1-26-00001')).toBe(true)
    expect(isValidIsrc('DEXX12600001X')).toBe(false)
    expect(normalizeCode(' de-xx1 26-00001 ')).toBe('DEXX12600001')
  })

  it('formats and reads durations', () => {
    expect(formatDuration(202)).toBe('3:22')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(null)).toBe('')
    expect(parseDuration('3:22')).toBe(202)
    expect(parseDuration('1:02:05')).toBe(3725)
    expect(parseDuration('95')).toBe(95)
    expect(parseDuration('')).toBe(null)
    expect(parseDuration('3:75')).toBe(undefined)
    expect(parseDuration('drei')).toBe(undefined)
  })

  it('sums shares per role', () => {
    const totals = shareTotals([
      { role: 'composer', sharePercent: 50 },
      { role: 'composer', sharePercent: 25 },
      { role: 'lyricist', sharePercent: null }
    ])
    expect(totals.get('composer')).toBe(75)
    expect(totals.has('lyricist')).toBe(false)
  })
})

describe('releases', () => {
  it('creates a release of a band and shows the band as artist', async () => {
    const b = await band('Probeband Eins')
    const created = ReleaseMapper.toDetailDto(
      await release({ bandId: b.id, releaseType: 'single', releaseDate: '2027-04-16' })
    )
    expect(created.artist).toBe('Probeband Eins')
    expect(created.releaseType).toBe('single')
    expect(created.tracks).toEqual([])

    const listed = await service().listByBand(b.id)
    expect(listed.map((r) => r.id)).toEqual([created.id])
  })

  it('keeps tracks with contributors and shares, and products with their tracklist', async () => {
    const created = await release({ artistName: 'Beispiel Artist' })
    let detail = await service().saveTrack(
      SaveTrackInput.parse({
        releaseId: created.id,
        title: 'Erster Song',
        durationSeconds: 202,
        isrc: 'de-xx1-26-00001',
        contributors: [{ name: 'Beispiel Artist', role: 'Primary Artist' }],
        workShares: [
          { name: 'Erika Muster', role: 'lyricist', sharePercent: 100 },
          { name: 'Max Beispiel', role: 'composer', sharePercent: 50 },
          { name: 'Erika Muster', role: 'composer', sharePercent: 50 }
        ]
      })
    )
    detail = await service().saveTrack(
      SaveTrackInput.parse({ releaseId: created.id, title: 'Zweiter Song' })
    )
    const [first, second] = detail.tracks
    expect(first.isrc).toBe('DEXX12600001')
    expect(detail.tracks.map((t) => t.position)).toEqual([0, 1])

    detail = await service().saveProduct(
      SaveProductInput.parse({
        releaseId: created.id,
        format: 'vinyl',
        upc: '4006381333931',
        tracks: [
          { trackId: second.id, side: 'A' },
          { trackId: first.id, side: 'B' }
        ]
      })
    )
    const dto = ReleaseMapper.toDetailDto(detail)
    expect(dto.upcs).toBe('4006381333931')
    expect(dto.products[0].tracks.map((t) => [t.trackId, t.side])).toEqual([
      [second.id, 'A'],
      [first.id, 'B']
    ])
    expect(dto.tracks[0].workShares.map((s) => s.sharePercent)).toEqual([100, 50, 50])
    expect(dto.tracks[0].contributors[0].role).toBe('Primary Artist')

    // editing a track replaces its contributors and shares
    const edited = await service().saveTrack(
      SaveTrackInput.parse({ id: first.id, releaseId: created.id, title: 'Erster Song (Edit)' })
    )
    expect(edited.tracks[0].work_shares).toEqual([])
    expect(edited.tracks[0].title).toBe('Erster Song (Edit)')

    // deleting a track takes it out of the tracklist too
    const afterDelete = await service().deleteTrack(second.id)
    expect(afterDelete.products[0].tracks.map((t) => t.track_id)).toEqual([first.id])
  })

  it('refuses a tracklist with a track of another release', async () => {
    const one = await release({ title: 'Eins' })
    const other = await release({ title: 'Anderes' })
    const withTrack = await service().saveTrack(
      SaveTrackInput.parse({ releaseId: other.id, title: 'Fremd' })
    )
    await expect(
      service().saveProduct(
        SaveProductInput.parse({
          releaseId: one.id,
          tracks: [{ trackId: withTrack.tracks[0].id }]
        })
      )
    ).rejects.toThrow('gehört nicht zu diesem Release')
  })

  it('moves tracks and keeps the release credits apart from track credits', async () => {
    const created = await release({ title: 'Reihenfolge' })
    for (const title of ['A', 'B', 'C'])
      await service().saveTrack(SaveTrackInput.parse({ releaseId: created.id, title }))
    let detail = await service().getDetail(created.id)
    detail = await service().moveTrack({ id: detail!.tracks[2].id, direction: 'up' })
    expect(detail.tracks.map((t) => t.title)).toEqual(['A', 'C', 'B'])

    detail = await service().saveCredits({
      releaseId: created.id,
      contributors: [
        { name: 'Studio Muster', role: 'Mixing Engineer', instrument: '', personId: null }
      ]
    })
    expect(detail.credits.map((c) => c.name)).toEqual(['Studio Muster'])
    expect(detail.tracks.every((t) => t.contributors.length === 0)).toBe(true)
  })

  it('finds a release by UPC or ISRC', async () => {
    const created = await release({ title: 'Suchalbum' })
    await service().saveTrack(
      SaveTrackInput.parse({ releaseId: created.id, title: 'X', isrc: 'DEXX12699999' })
    )
    await service().saveProduct(
      SaveProductInput.parse({ releaseId: created.id, upc: '036000291452' })
    )
    const byUpc = await service().getAllPaginated({ page: 1, pageSize: 10, search: '036000291452' })
    const byIsrc = await service().getAllPaginated({
      page: 1,
      pageSize: 10,
      search: 'DE-XX1-26-99999'
    })
    expect(byUpc.items.map((r) => r.id)).toEqual([created.id])
    expect(byIsrc.items.map((r) => r.id)).toEqual([created.id])
  })

  it('keeps the release when its band is deleted', async () => {
    const b = await band('Probeband Zwei')
    const created = await release({ bandId: b.id, title: 'Bleibt' })
    await container.resolve(BandService).deleteBand(b.id)
    const row = db().select().from(schema.release).where(eq(schema.release.id, created.id)).get()
    expect(row?.band_id).toBeNull()
  })

  it('deletes products, tracks and credits with the release', async () => {
    const created = await release({ title: 'Weg' })
    await service().saveTrack(
      SaveTrackInput.parse({
        releaseId: created.id,
        title: 'T',
        workShares: [{ name: 'Erika Muster' }]
      })
    )
    await service().saveProduct(SaveProductInput.parse({ releaseId: created.id }))
    await service().delete(created.id)
    expect(
      db()
        .select()
        .from(schema.release_track)
        .all()
        .some((t) => t.release_id === created.id)
    ).toBe(false)
    expect(
      db()
        .select()
        .from(schema.release_product)
        .all()
        .some((p) => p.release_id === created.id)
    ).toBe(false)
  })

  it('updates the head data', async () => {
    const created = await release({ title: 'Alt' })
    const updated = await service().update(
      UpdateReleaseInput.parse({ id: created.id, title: 'Neu', label: 'Beispiel Records' })
    )
    expect(updated.title).toBe('Neu')
    expect(updated.label).toBe('Beispiel Records')
  })

  it('gives the sync natural keys', () => {
    expect(keyOf('release_track', { release_id: 1, isrc: 'DEXX12600001', title: 'A' })).toBe(
      keyOf('release_track', { release_id: 1, isrc: 'DEXX12600001', title: 'B' })
    )
    expect(keyOf('release_product', { release_id: 1, upc: '', catalog_number: '' })).toBeNull()
  })
})
