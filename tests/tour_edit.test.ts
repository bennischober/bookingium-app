// Editing a tour on the Touren page: a tour is only the name events share, so renaming it
// changes every event (archived ones too) and marketing measure, a taken name merges two tours,
// and the ticked active events become exactly its shows.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { TourImportService } from '../src/main/services/TourImportService'
import { SaveTourInput, type TourCandidateDto } from '../src/main/api/schemas/tour_import.schema'
import {
  ALL_BANDS,
  initialTourState,
  visibleShows,
  withTourShows
} from '../src/renderer/src/components/tour/tourEdit'
import { setupTestDb } from './helpers/setup'

setupTestDb()

let counter = 0
function seedBand() {
  counter++
  const owner = db
    .insert(schema.company)
    .values({ name: `Firma ${counter}` })
    .returning()
    .get()
  return db
    .insert(schema.band)
    .values({ name: `Band ${counter}`, company_id: owner.id })
    .returning()
    .get()
}

function seedEvent(bandId: number, date: string, tour = '', archived = false) {
  const address = db.insert(schema.address).values({ city: 'Köln' }).returning().get()
  const venue = db
    .insert(schema.venue)
    .values({ name: `Club ${date}`, kind: 'venue', address_id: address.id })
    .returning()
    .get()
  return db
    .insert(schema.deal_memo)
    .values({
      band_id: bandId,
      date,
      name: `Show ${date}`,
      venue_id: venue.id,
      tour,
      archived_at: archived ? '2026-01-01T00:00:00Z' : null
    })
    .returning()
    .get()
}

const tourOf = (id: number) =>
  db.select().from(schema.deal_memo).where(eq(schema.deal_memo.id, id)).get()?.tour

describe('tour editing', () => {
  const service = () => container.resolve(TourImportService)

  it('offers active events with band, club and city', () => {
    const band = seedBand()
    const active = seedEvent(band.id, '2031-03-01', 'Offer')
    const archived = seedEvent(band.id, '2031-03-02', 'Offer', true)
    const offered = service().tourCandidates()
    const row = offered.find((show) => show.id === active.id)
    expect(row).toMatchObject({
      bandName: band.name,
      venueName: 'Club 2031-03-01',
      city: 'Köln',
      tour: 'Offer'
    })
    expect(offered.some((show) => show.id === archived.id)).toBe(false)
  })

  it('renames everywhere, adds ticked shows and takes out unticked ones', () => {
    const band = seedBand()
    const a = seedEvent(band.id, '2031-04-01', 'Frühjahr')
    const b = seedEvent(band.id, '2031-04-02', 'Frühjahr')
    const old = seedEvent(band.id, '2020-04-02', 'Frühjahr', true)
    const free = seedEvent(band.id, '2031-04-03')
    const action = db
      .insert(schema.marketing_action)
      .values({ band_id: band.id, kind: 'radio_spot', title: 'Spot', tour: 'Frühjahr' })
      .returning()
      .get()

    const result = service().saveTour(
      SaveTourInput.parse({
        previous: 'Frühjahr',
        name: ' Frühjahr 2031 ',
        eventIds: [a.id, free.id]
      })
    )

    expect(result).toEqual({ name: 'Frühjahr 2031', added: 1, removed: 1, renamed: 3 })
    expect(tourOf(a.id)).toBe('Frühjahr 2031')
    expect(tourOf(free.id)).toBe('Frühjahr 2031')
    expect(tourOf(b.id)).toBe('')
    // the archived show keeps belonging to the renamed tour
    expect(tourOf(old.id)).toBe('Frühjahr 2031')
    const renamedAction = db
      .select()
      .from(schema.marketing_action)
      .where(eq(schema.marketing_action.id, action.id))
      .get()
    expect(renamedAction?.tour).toBe('Frühjahr 2031')
    expect(service().tours()).toContain('Frühjahr 2031')
    expect(service().tours()).not.toContain('Frühjahr')
  })

  it('merges into a tour that already has the name and moves shows from another tour', () => {
    const band = seedBand()
    const x = seedEvent(band.id, '2031-05-01', 'Merge A')
    const y = seedEvent(band.id, '2031-05-02', 'Merge B')
    const z = seedEvent(band.id, '2031-05-03', 'Other')

    service().saveTour(
      SaveTourInput.parse({ previous: 'Merge A', name: 'Merge B', eventIds: [x.id, y.id, z.id] })
    )

    expect([tourOf(x.id), tourOf(y.id), tourOf(z.id)]).toEqual(['Merge B', 'Merge B', 'Merge B'])
    expect(service().tours()).not.toContain('Merge A')
    expect(service().tours()).not.toContain('Other')
  })

  it('makes a new tour from ticked shows and never touches archived ones by id', () => {
    const band = seedBand()
    const show = seedEvent(band.id, '2031-06-01')
    const archived = seedEvent(band.id, '2031-06-02', '', true)
    const result = service().saveTour(
      SaveTourInput.parse({ name: 'Sommer', eventIds: [show.id, archived.id] })
    )
    expect(result.added).toBe(1)
    expect(tourOf(show.id)).toBe('Sommer')
    expect(tourOf(archived.id)).toBe('')
  })

  it('needs a name', () => {
    expect(SaveTourInput.safeParse({ name: '   ' }).success).toBe(false)
  })
})

describe('tour dialog list', () => {
  const show = (id: number, overrides: Partial<TourCandidateDto> = {}): TourCandidateDto => ({
    id,
    date: '2031-01-10',
    name: `Show ${id}`,
    bandId: 1,
    bandName: 'Alpha',
    venueName: 'Club',
    city: 'Köln',
    status: 'confirmed',
    tour: '',
    ...overrides
  })
  const filter = {
    search: '',
    band: ALL_BANDS,
    showPast: false,
    onlyFree: false,
    today: '2031-01-01'
  }

  it('filters by search words, band, past and free, but keeps ticked shows', () => {
    const shows = [
      show(1),
      show(2, { bandId: 2, bandName: 'Beta', city: 'Berlin' }),
      show(3, { date: '2030-12-01' }),
      show(4, { tour: 'Andere' })
    ]
    const ids = (list: TourCandidateDto[]) => list.map((s) => s.id)
    expect(ids(visibleShows(shows, new Set(), filter))).toEqual([1, 2, 4])
    expect(ids(visibleShows(shows, new Set(), { ...filter, search: 'beta berlin' }))).toEqual([2])
    expect(ids(visibleShows(shows, new Set(), { ...filter, band: '1', onlyFree: true }))).toEqual([
      1
    ])
    expect(ids(visibleShows(shows, new Set([3]), { ...filter, search: 'nichts' }))).toEqual([3])
  })

  it('opens with the tour shows ticked and their band preset', () => {
    const shows = [
      show(1, { tour: 'T', date: '2030-05-01' }),
      show(2, { tour: 'T' }),
      show(3, { bandId: 2, tour: 'U' })
    ]
    const state = initialTourState(shows, 'T', '2031-01-01')
    expect([...state.selected]).toEqual([1, 2])
    expect(state.band).toBe('1')
    expect(state.showPast).toBe(true)
    expect(initialTourState(shows, '', '2031-01-01').selected.size).toBe(0)
    expect([...withTourShows(new Set([1]), shows, 'U')]).toEqual([1, 3])
  })
})
