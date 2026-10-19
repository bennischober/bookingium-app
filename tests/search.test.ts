// Search service tests: LIKE queries across business objects, lightweight
// payloads, per-type and total limits.
import 'reflect-metadata'
import { describe, it, expect, beforeAll } from 'vitest'
import { container } from 'tsyringe'
import { SearchService } from '../src/main/services/SearchService'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandRepository } from '../src/main/repositories/BandRepository'
import { DealMemoRepository } from '../src/main/repositories/DealMemoRepository'

import { setupTestDb } from './helpers/setup'

setupTestDb()

describe('SearchService', () => {
  const service = container.resolve(SearchService)

  beforeAll(async () => {
    const companies = container.resolve(CompanyService)
    const bandRepo = container.resolve(BandRepository)
    const memoRepo = container.resolve(DealMemoRepository)

    const company = await companies.createCompany({
      name: 'Searchbeat Records',
      isDefaultForInvoicing: false
    })
    await bandRepo.create({
      name: 'The Searchers',
      genre: 'Beat',
      notes: '',
      companyId: company.id
    })
    await memoRepo.create({
      name: 'Searchfest Open Air',
      date: '2026-07-15',
      bandId: 1,
      venueId: null
    })
  })

  it('finds companies by name', async () => {
    const { results } = await service.search('Searchbeat')
    const company = results.find((r) => r.type === 'company')
    expect(company).toBeDefined()
    expect(company?.label).toBe('Searchbeat Records')
    expect(company?.route).toBe('/companies/$companyId')
    expect(company?.routeParams).toEqual({ companyId: String(company?.id) })
  })

  it('finds bands by name and events by name', async () => {
    const { results } = await service.search('Search')
    const band = results.find((r) => r.type === 'band')
    const event = results.find((r) => r.type === 'event')
    expect(band?.label).toBe('The Searchers')
    expect(event?.label).toBe('Searchfest Open Air')
    expect(event?.routeParams).toEqual({ eventId: event?.id.toString() })
  })

  it('is case-insensitive', async () => {
    const { results } = await service.search('searchbeat')
    expect(results.find((r) => r.type === 'company')).toBeDefined()
  })

  it('returns empty for no matches', async () => {
    const { results, truncated } = await service.search('zzzznichtvorhanden')
    expect(results).toHaveLength(0)
    expect(truncated).toBe(false)
  })

  it('respects per-type limit', async () => {
    const { results } = await service.search('a', 2)
    const perType = new Map<string, number>()
    for (const r of results) perType.set(r.type, (perType.get(r.type) ?? 0) + 1)
    for (const [, count] of perType) expect(count).toBeLessThanOrEqual(2)
  })

  it('caps the total number of results at 24', async () => {
    const { results } = await service.search('e', 10)
    expect(results.length).toBeLessThanOrEqual(24)
  })
})
