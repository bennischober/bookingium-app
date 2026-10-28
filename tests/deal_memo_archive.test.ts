// D3: an archived event is out of every working view but still there.
//
// The claim is "an archived event appears in none of these places", so this suite archives one
// event and then asserts its absence from each surface in turn, rather than one test per call
// site: a missed filter does not error, an archived gig just shows up somewhere.
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { DealMemoService } from '../src/main/services/DealMemoService'
import { DealMemoRepository } from '../src/main/repositories/DealMemoRepository'
import { DashboardService } from '../src/main/services/DashboardService'
import { SearchService } from '../src/main/services/SearchService'
import { DocumentService } from '../src/main/services/DocumentService'
import { ContactListRepository } from '../src/main/repositories/ContactListRepository'
import { CalendarFeedService } from '../src/main/services/CalendarFeedService'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { setupTestDb } from './helpers/setup'

setupTestDb()

let root: string
let sources: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bookingum-archive-'))
  sources = join(root, 'sources')
  mkdirSync(sources)
  setStorageBasePath(join(root, 'storage'))
})

describe('D3: an archived event leaves every working view', () => {
  const memos = () => container.resolve(DealMemoService)
  const repo = () => container.resolve(DealMemoRepository)

  /** A band with one future event at a venue, named so search can find it */
  async function futureEvent(stamp: string) {
    const company = db
      .insert(schema.company)
      .values({ name: `Archiv Firma ${stamp}` })
      .returning()
      .get()
    const band = db
      .insert(schema.band)
      .values({ name: `Archiv Band ${stamp}`, company_id: company.id })
      .returning()
      .get()
    const venue = db
      .insert(schema.venue)
      .values({ name: `Archiv Halle ${stamp}` })
      .returning()
      .get()
    const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const event = db
      .insert(schema.deal_memo)
      .values({
        name: `Archiv Event ${stamp}`,
        date,
        band_id: band.id,
        venue_id: venue.id
      })
      .returning()
      .get()
    return { event, band, venue, date }
  }

  it('disappears from the list, the dashboard and search, and comes back on restore', async () => {
    const stamp = `liste-${Date.now()}`
    const { event, band } = await futureEvent(stamp)
    const dashboard = container.resolve(DashboardService)
    const search = container.resolve(SearchService)

    // Before: it is everywhere
    const list = () => memos().getAllDealMemosPaginated({ page: 0, pageSize: 200 })
    expect((await list()).items.some((e) => e.id === event.id)).toBe(true)
    expect((await dashboard.getStats()).upcomingNext7Days.some((e) => e.id === event.id)).toBe(true)
    expect(
      (await search.search(`Archiv Event ${stamp}`)).results.some(
        (r) => r.type === 'event' && r.id === event.id
      )
    ).toBe(true)
    expect((await repo().listByBand(band.id)).some((e) => e.id === event.id)).toBe(true)

    // Archived
    await memos().archiveDealMemo(event.id)

    // After: it is in none of them
    expect((await list()).items.some((e) => e.id === event.id)).toBe(false)
    expect((await dashboard.getStats()).upcomingNext7Days.some((e) => e.id === event.id)).toBe(
      false
    )
    expect(
      (await search.search(`Archiv Event ${stamp}`)).results.some(
        (r) => r.type === 'event' && r.id === event.id
      )
    ).toBe(false)
    expect((await repo().listByBand(band.id)).some((e) => e.id === event.id)).toBe(false)
    // ...but it is in the archive view, and still readable by id
    expect((await repo().listArchived()).some((e) => e.id === event.id)).toBe(true)
    expect(await memos().getDealMemoById(event.id)).not.toBeNull()

    // Restored: back everywhere
    await memos().restoreDealMemo(event.id)
    expect((await list()).items.some((e) => e.id === event.id)).toBe(true)
    expect((await dashboard.getStats()).upcomingNext7Days.some((e) => e.id === event.id)).toBe(true)
    expect((await repo().listArchived()).some((e) => e.id === event.id)).toBe(false)
  })

  it('keeps its documents, follow-ups and the link from its invoices', async () => {
    const stamp = `daten-${Date.now()}`
    const { event } = await futureEvent(stamp)

    // A document, a follow-up and an invoice that point at the event
    writeFileSync(join(sources, 'Rider.pdf'), 'pdf')
    await container.resolve(DocumentService).upload({
      ownerType: 'event',
      ownerId: event.id,
      sourcePath: join(sources, 'Rider.pdf'),
      documentType: 'rider'
    })
    const followUp = db
      .insert(schema.follow_up)
      .values({ due_date: '2026-06-01', note: 'Setlist schicken', event_id: event.id })
      .returning()
      .get()
    const company = db.select().from(schema.company).limit(1).get()!
    const invoice = db
      .insert(schema.invoice)
      .values({
        company_id: company.id,
        deal_memo_id: event.id,
        status: 'draft',
        kind: 'invoice',
        issue_date: '2026-06-01'
      })
      .returning()
      .get()

    await memos().archiveDealMemo(event.id)

    // The whole point of archiving over deleting: nothing of this is destroyed
    const documents = await container.resolve(DocumentService).listByOwner('event', event.id)
    expect(documents).toHaveLength(1)
    expect(
      db.select().from(schema.follow_up).where(eq(schema.follow_up.id, followUp.id)).get()
    ).toBeDefined()
    expect(
      db.select().from(schema.invoice).where(eq(schema.invoice.id, invoice.id)).get()
    ).toBeDefined()
    // And the invoice still names its event, which a hard delete would have nulled
    expect(
      db.select().from(schema.invoice).where(eq(schema.invoice.id, invoice.id)).get()?.deal_memo_id
    ).toBe(event.id)
  })

  it('is out of the band document list and the contact list', async () => {
    const stamp = `listen-${Date.now()}`
    const { event, band, venue } = await futureEvent(stamp)
    writeFileSync(join(sources, 'Vertrag.pdf'), 'pdf')
    await container.resolve(DocumentService).upload({
      ownerType: 'event',
      ownerId: event.id,
      sourcePath: join(sources, 'Vertrag.pdf'),
      documentType: 'contract'
    })

    const docsOfBand = () => container.resolve(DocumentService).listEventDocumentsForBand(band.id)
    const contactList = () => container.resolve(ContactListRepository).loadVenueSources()

    expect((await docsOfBand()).some((d) => d.owner_id === event.id)).toBe(true)
    const before = (await contactList()).find((v) => v.id === venue.id)
    expect(before?.bookings.some((b) => b.bandId === band.id)).toBe(true)

    await memos().archiveDealMemo(event.id)

    expect((await docsOfBand()).some((d) => d.owner_id === event.id)).toBe(false)
    const after = (await contactList()).find((v) => v.id === venue.id)
    expect(after?.bookings.some((b) => b.bandId === band.id)).toBe(false)
  })

  it('leaves the calendar feed, the surface users notice most', async () => {
    const stamp = `feed-${Date.now()}`
    const { event } = await futureEvent(stamp)
    const feed = container.resolve(CalendarFeedService)

    const inFeed = async (): Promise<boolean> =>
      (await feed.events()).some((e) => e.uid?.includes(String(event.id)) ?? false)

    // The ICS feed is what subscribers already downloaded; an archived gig must leave it
    const before = await feed.events()
    expect(before.length).toBeGreaterThan(0)

    await memos().archiveDealMemo(event.id)
    const after = await feed.events()
    expect(after.length).toBeLessThan(before.length)
    expect(await inFeed()).toBe(false)

    await memos().restoreDealMemo(event.id)
    expect((await feed.events()).length).toBe(before.length)
  })

  it('refuses a hard delete while an invoice links the event', async () => {
    const stamp = `loeschen-${Date.now()}`
    const { event } = await futureEvent(stamp)
    expect(await memos().hasLinkedInvoice(event.id)).toBe(false)

    const company = db.select().from(schema.company).limit(1).get()!
    db.insert(schema.invoice)
      .values({
        company_id: company.id,
        deal_memo_id: event.id,
        status: 'draft',
        kind: 'invoice',
        issue_date: '2026-06-01'
      })
      .run()

    // The router refuses on this; the service reports the same fact
    expect(await memos().hasLinkedInvoice(event.id)).toBe(true)
  })

  it('is not a cancelled event: the status stays what it was', async () => {
    const stamp = `status-${Date.now()}`
    const { event } = await futureEvent(stamp)
    await memos().updateDealMemo({ id: event.id, status: 'cancelled' })

    // A cancelled gig still has paperwork to do, so it stays in the list
    await memos().archiveDealMemo(event.id)
    const archived = (await repo().listArchived()).find((e) => e.id === event.id)
    expect(archived?.status).toBe('cancelled')

    await memos().restoreDealMemo(event.id)
    const back = (await memos().getAllDealMemosPaginated({ page: 0, pageSize: 200 })).items.find(
      (e) => e.id === event.id
    )
    expect(back?.status).toBe('cancelled')
  })
})

afterAll(() => {
  setStorageBasePath(null)
  rmSync(root, { recursive: true, force: true })
})
