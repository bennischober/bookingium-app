// #162: companies and bands that other records still point at (no ON DELETE
// rule) are refused with a readable message instead of a SQLite FK error.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { setupTestDb, getTestDb } from './helpers/setup'
import { schema } from '../src/main/db/schema'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandService } from '../src/main/services/BandService'

setupTestDb()

const insertCompany = (name: string) => {
  const { db } = getTestDb()
  return db.insert(schema.company).values({ name }).returning().get()
}
const insertBand = (name: string, companyId: number) => {
  const { db } = getTestDb()
  return db.insert(schema.band).values({ name, company_id: companyId }).returning().get()
}
const insertEvent = (bandId: number) => {
  const { db } = getTestDb()
  return db
    .insert(schema.deal_memo)
    .values({ name: 'Show', date: '2026-05-01', band_id: bandId })
    .returning()
    .get()
}

describe('deleting a company', () => {
  it('is refused while bands and invoices point at it', async () => {
    const service = container.resolve(CompanyService)
    const owner = insertCompany('Blocked Co')
    insertBand('Band A', owner.id)
    insertBand('Band B', owner.id)
    getTestDb().db.insert(schema.invoice).values({ company_id: owner.id }).run()

    await expect(service.deleteCompany(owner.id)).rejects.toThrow(
      'Die Firma ist noch mit 2 Bands und 1 Rechnung verknüpft und kann nicht gelöscht werden.'
    )
    expect(await service.getCompanyById(owner.id)).not.toBeNull()
  })

  it('names only the links that exist', async () => {
    const service = container.resolve(CompanyService)
    const owner = insertCompany('Band Only Co')
    insertBand('Band C', owner.id)
    await expect(service.deleteCompany(owner.id)).rejects.toThrow(
      'Die Firma ist noch mit 1 Band verknüpft'
    )
  })

  it('goes through once nothing points at it', async () => {
    const service = container.resolve(CompanyService)
    const free = insertCompany('Free Co')
    await service.deleteCompany(free.id)
    expect(await service.getCompanyById(free.id)).toBeNull()
  })
})

describe('deleting a band', () => {
  it('is refused while events point at it', async () => {
    const service = container.resolve(BandService)
    const owner = insertCompany('Label Co')
    const band = insertBand('Touring Band', owner.id)
    insertEvent(band.id)
    insertEvent(band.id)

    await expect(service.deleteBand(band.id)).rejects.toThrow(
      'Die Band hat noch 2 Events und kann nicht gelöscht werden.'
    )
  })

  it('goes through once it has no events', async () => {
    const service = container.resolve(BandService)
    const owner = insertCompany('Quiet Co')
    const band = insertBand('Quiet Band', owner.id)
    const deleted = await service.deleteBand(band.id)
    expect(deleted?.id).toBe(band.id)
  })
})
