// Contract data assembly tests. Regression: the promoter query originally
// joined person against deal_memo.lopro_person_id while querying FROM
// company (deal_memo not in scope) -> 'no such column' at runtime, which
// surfaced as an endless-loading contract print view.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { ContractService } from '../src/main/services/ContractService'
import { CompanyService } from '../src/main/services/CompanyService'
import { DealMemoRepository } from '../src/main/repositories/DealMemoRepository'
import { BandRepository } from '../src/main/repositories/BandRepository'

import { setupTestDb } from './helpers/setup'

setupTestDb()

async function seedScenario() {
  const companies = container.resolve(CompanyService)
  const contracts = container.resolve(ContractService)

  // Artist company (band owner) with full contract-relevant data
  const artistCompany = await companies.createCompany({
    name: 'Artist Booking GmbH',
    vatNumber: 'DE212298737',
    taxNumber: '12712063600',
    commercialRegisterNo: 'HRB 7710',
    registerCourt: 'AG Kempten',
    kskNumber: '84082625X003',
    isDefaultForInvoicing: true
  })

  // Promoter company
  const promoterCompany = await companies.createCompany({
    name: 'Örtlicher Veranstalter e.V.',
    vatNumber: 'DE111111111',
    kskNumber: '',
    isDefaultForInvoicing: false
  })

  return { companies, contracts, artistCompany, promoterCompany }
}

describe('ContractService', () => {
  it('returns null for a non-existent deal memo', async () => {
    const { contracts } = await seedScenario()
    const data = await contracts.getContractData(99999)
    expect(data).toBeNull()
  })

  it('assembles contract parties from band company and lopro company', async () => {
    const { contracts, artistCompany, promoterCompany } = await seedScenario()
    const dealMemoRepo = container.resolve(DealMemoRepository)
    const bandRepo = container.resolve(BandRepository)

    const band = await bandRepo.create({
      name: 'Test Band',
      genre: 'Rock',
      notes: '',
      companyId: artistCompany.id
    })

    const memo = await dealMemoRepo.create({
      name: 'Test Show',
      date: '2026-11-05',
      bandId: band.id,
      venueId: null,
      loProCompanyId: promoterCompany.id,
      guaranteeAmount: 4000,
      guaranteeVatRate: 7,
      contractNotes: 'Sondervereinbarung: Backline gestellt.'
    })

    const data = await contracts.getContractData(memo.id)
    expect(data).not.toBeNull()
    expect(data?.band?.name).toBe('Test Band')
    expect(data?.artist?.name).toBe('Artist Booking GmbH')
    expect(data?.artist?.kskNumber).toBe('84082625X003')
    expect(data?.promoter?.name).toBe('Örtlicher Veranstalter e.V.')
    expect(data?.dealMemo.guaranteeAmount).toBe(4000)
    expect(data?.dealMemo.guaranteeVatRate).toBe(7)
    expect(data?.dealMemo.contractNotes).toBe('Sondervereinbarung: Backline gestellt.')
    expect(data?.venue).toBeNull()
  })

  it('works when the promoter company has no linked contact/bank (left joins)', async () => {
    const { contracts, artistCompany, promoterCompany } = await seedScenario()
    const dealMemoRepo = container.resolve(DealMemoRepository)
    const bandRepo = container.resolve(BandRepository)

    const band = await bandRepo.create({
      name: 'Second Band',
      genre: '',
      notes: '',
      companyId: artistCompany.id
    })

    const memo = await dealMemoRepo.create({
      name: 'Second Show',
      date: '2026-12-01',
      bandId: band.id,
      venueId: null,
      loProCompanyId: promoterCompany.id
    })

    const data = await contracts.getContractData(memo.id)
    expect(data?.promoter?.name).toBe('Örtlicher Veranstalter e.V.')
    expect(data?.promoter?.email).toBe('')
    expect(data?.promoter?.iban).toBe('')
  })

  it('resolves the technician: explicit field wins over TL-role heuristic', async () => {
    const { contracts, artistCompany, promoterCompany } = await seedScenario()
    const dealMemoRepo = container.resolve(DealMemoRepository)
    const bandRepo = container.resolve(BandRepository)

    // Create persons via PersonRepository
    const personRepo = container.resolve(
      (await import('../src/main/repositories/PersonRepository')).PersonRepository
    )
    const tlPerson = await personRepo.create({
      firstName: 'Tech',
      lastName: 'Leader',
      notes: ''
    })
    const rookiePerson = await personRepo.create({
      firstName: 'Rookie',
      lastName: 'Member',
      notes: ''
    })

    const band = await bandRepo.create({
      name: 'TL Band',
      genre: '',
      notes: '',
      companyId: artistCompany.id
    })

    // Add members: rookie without role, TL with role containing 'TL'
    const { db } = await import('../src/main/db/index')
    const { schema } = await import('../src/main/db/schema')
    await db.insert(schema.band_member).values([
      { band_id: band.id, person_id: rookiePerson.id, role: 'Drums' },
      { band_id: band.id, person_id: tlPerson.id, role: 'Guitar, TL' }
    ]) // Without explicit field: heuristic finds the member with 'TL' in role
    const memo1 = await dealMemoRepo.create({
      name: 'Show A',
      date: '2026-11-01',
      bandId: band.id,
      venueId: null,
      loProCompanyId: promoterCompany.id
    })
    const data1 = await contracts.getContractData(memo1.id)
    expect(data1?.technician?.firstName).toBe('Tech')

    // With explicit field: it wins
    await bandRepo.update({ id: band.id, responsiblePersonId: rookiePerson.id })
    const memo2 = await dealMemoRepo.create({
      name: 'Show B',
      date: '2026-11-02',
      bandId: band.id,
      venueId: null,
      loProCompanyId: promoterCompany.id
    })
    const data2 = await contracts.getContractData(memo2.id)
    expect(data2?.technician?.firstName).toBe('Rookie')
  })
})
