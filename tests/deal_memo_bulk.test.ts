// #200: the status of several events at once, and archiving several, each undoable; plus the
// rules of picking rows in a list (lib/rowSelection).
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { inArray } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { DealMemoService } from '../src/main/services/DealMemoService'
import { SetDealMemoStatusesInput } from '../src/main/api/schemas/deal_memo.schema'
import {
  keepShownRows,
  selectionLabel,
  selectionState,
  toggleAllRows,
  toggleRow
} from '../src/renderer/src/lib/rowSelection'
import { setupTestDb } from './helpers/setup'

setupTestDb()

/** Events of one band, with the given statuses */
function events(stamp: string, statuses: string[]): number[] {
  const company = db
    .insert(schema.company)
    .values({ name: `Bulk Firma ${stamp}` })
    .returning()
    .get()
  const band = db
    .insert(schema.band)
    .values({ name: `Bulk Band ${stamp}`, company_id: company.id })
    .returning()
    .get()
  return statuses.map(
    (status, index) =>
      db
        .insert(schema.deal_memo)
        .values({
          name: `Bulk ${stamp} ${index}`,
          band_id: band.id,
          date: `2026-12-${String(index + 1).padStart(2, '0')}`,
          status
        })
        .returning()
        .get().id
  )
}

const statusesOf = (ids: number[]) =>
  db
    .select({ id: schema.deal_memo.id, status: schema.deal_memo.status })
    .from(schema.deal_memo)
    .where(inArray(schema.deal_memo.id, ids))
    .all()
    .sort((a, b) => a.id - b.id)
    .map((row) => row.status)

const archivedOf = (ids: number[]) =>
  db
    .select({ id: schema.deal_memo.id, archived: schema.deal_memo.archived_at })
    .from(schema.deal_memo)
    .where(inArray(schema.deal_memo.id, ids))
    .all()
    .sort((a, b) => a.id - b.id)
    .map((row) => row.archived !== null)

describe('#200: the status of several events at once', () => {
  const service = () => container.resolve(DealMemoService)

  it('sets one status for all and answers with what changed, which undoes it', () => {
    const ids = events('status', ['pending', 'confirmed', 'cancelled'])
    const before = service().setDealMemoStatuses({
      changes: ids.map((id) => ({ id, status: 'confirmed' }))
    })
    expect(statusesOf(ids)).toEqual(['confirmed', 'confirmed', 'confirmed'])
    // the one already confirmed is not in the answer, so undoing leaves it alone
    expect(before.changes).toEqual([
      { id: ids[0], status: 'pending' },
      { id: ids[2], status: 'cancelled' }
    ])

    service().setDealMemoStatuses(before)
    expect(statusesOf(ids)).toEqual(['pending', 'confirmed', 'cancelled'])
  })

  it('skips an event that no longer exists', () => {
    const [id] = events('gone', ['pending'])
    const before = service().setDealMemoStatuses({
      changes: [
        { id, status: 'cancelled' },
        { id: 999_999_999, status: 'cancelled' }
      ]
    })
    expect(before.changes).toEqual([{ id, status: 'pending' }])
  })

  it('takes only the known statuses, and at least one event', () => {
    expect(() =>
      SetDealMemoStatusesInput.parse({ changes: [{ id: 1, status: 'abgesagt' }] })
    ).toThrow()
    expect(() => SetDealMemoStatusesInput.parse({ changes: [] })).toThrow()
  })

  it('archives several and restores exactly those (undo)', () => {
    const ids = events('archive', ['pending', 'pending', 'confirmed'])
    // one is archived already: it stays archived after undoing
    service().archiveDealMemos([ids[2]])

    const archived = service().archiveDealMemos(ids)
    expect(archived.ids).toEqual([ids[0], ids[1]])
    expect(archivedOf(ids)).toEqual([true, true, true])

    expect(service().restoreDealMemos(archived.ids).ids).toEqual([ids[0], ids[1]])
    expect(archivedOf(ids)).toEqual([false, false, true])
  })
})

describe('#200: picking rows in a list', () => {
  it('toggles one row', () => {
    expect([...toggleRow(new Set([1]), 2)]).toEqual([1, 2])
    expect([...toggleRow(new Set([1, 2]), 1)]).toEqual([2])
  })

  it('shows none, some or all of the loaded rows picked', () => {
    expect(selectionState(new Set(), [1, 2])).toBe('none')
    expect(selectionState(new Set([1]), [1, 2])).toBe('some')
    expect(selectionState(new Set([1, 2]), [1, 2])).toBe('all')
    expect(selectionState(new Set([9]), [1, 2])).toBe('none')
  })

  it('picks all loaded rows, or unpicks them when all are picked', () => {
    expect([...toggleAllRows(new Set([1]), [1, 2, 3])]).toEqual([1, 2, 3])
    expect([...toggleAllRows(new Set([1, 2, 3]), [1, 2, 3])]).toEqual([])
  })

  it('keeps only rows the list still shows, and the same set when nothing went', () => {
    const picked = new Set([1, 2, 3])
    expect(keepShownRows(picked, [1, 2, 3, 4])).toBe(picked)
    expect([...keepShownRows(picked, [2, 4])]).toEqual([2])
  })

  it('says how many are picked', () => {
    const label = { singular: 'Event', plural: 'Events' }
    expect(selectionLabel(1, label)).toBe('1 Event ausgewählt')
    expect(selectionLabel(1200, label)).toBe('1.200 Events ausgewählt')
  })
})
