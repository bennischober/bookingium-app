// List queries: server-side sorting (case-insensitive, empty values last in
// both directions, unknown columns fall back to the default) and cursor
// paging that stays stable across equal values.
import 'reflect-metadata'
import { describe, it, expect, beforeAll } from 'vitest'
import { container } from 'tsyringe'
import { VenueRepository } from '../src/main/repositories/VenueRepository'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const repo = () => container.resolve(VenueRepository)
const names = (items: Array<{ name: string }>) => items.map((item) => item.name)
const base = { page: 1, pageSize: 100 }

beforeAll(() => {
  db.insert(schema.venue)
    .values([
      { name: 'beta Halle', capacity: 300 },
      { name: 'Alpha Club', capacity: null },
      { name: 'Gamma Arena', capacity: 5000 },
      { name: 'delta Bar', capacity: 300 },
      { name: 'Epsilon', capacity: 80 }
    ])
    .run()
})

describe('list sorting', () => {
  it('sorts text case-insensitively by default (name)', async () => {
    const result = await repo().getAllPaginated(base)
    expect(names(result.items)).toEqual([
      'Alpha Club',
      'beta Halle',
      'delta Bar',
      'Epsilon',
      'Gamma Arena'
    ])
  })

  it('puts empty values last in both directions', async () => {
    const asc = await repo().getAllPaginated({ ...base, sortBy: 'capacity', sortDir: 'asc' })
    expect(names(asc.items)).toEqual([
      'Epsilon',
      'beta Halle',
      'delta Bar',
      'Gamma Arena',
      'Alpha Club'
    ])
    const desc = await repo().getAllPaginated({ ...base, sortBy: 'capacity', sortDir: 'desc' })
    expect(names(desc.items)[0]).toBe('Gamma Arena')
    expect(names(desc.items).at(-1)).toBe('Alpha Club')
  })

  it('falls back to the default order for unknown columns', async () => {
    const result = await repo().getAllPaginated({ ...base, sortBy: 'nope', sortDir: 'desc' })
    expect(names(result.items)[0]).toBe('Alpha Club')
  })
})

describe('cursor paging', () => {
  it('returns the cursor page and never repeats rows across pages', async () => {
    const query = { page: 1, pageSize: 2, sortBy: 'capacity', sortDir: 'asc' as const }
    const seen: string[] = []
    for (let cursor = 1; cursor <= 3; cursor++) {
      const result = await repo().getAllPaginated({ ...query, cursor })
      expect(result.page).toBe(cursor)
      expect(result.totalPages).toBe(3)
      seen.push(...names(result.items))
    }
    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
  })
})
