// Management contract tests: defaults for a band's first contract, copying
// terms into the next one, member/representative rules and print data.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { ManagementContractService } from '../src/main/services/ManagementContractService'
import { BandRepository } from '../src/main/repositories/BandRepository'
import { PersonRepository } from '../src/main/repositories/PersonRepository'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const address = (street: string, zipCode: string, city: string) => ({
  street,
  streetNumber: '1',
  addressSuffix: '',
  zipCode,
  city,
  state: '',
  country: 'Germany',
  countryCode: 'DE'
})

async function setup(name: string) {
  const companies = container.resolve(CompanyService)
  const people = container.resolve(PersonRepository)
  const bands = container.resolve(BandRepository)

  const bandCompany = await companies.createCompany({
    name: `${name} GbR`,
    address: address('Bandweg', '61267', 'Neu-Anspach'),
    isDefaultForInvoicing: false
  })
  const management = await companies.createCompany({
    name: `${name} Management AG`,
    address: address('Weidachstr.', '87541', 'Bad Hindelang'),
    contact: { email: 'mgmt@example.com', phone: '', mobilePhone: '', homepage: '' },
    isDefaultForInvoicing: false
  })
  const singer = await people.create({
    firstName: 'Benjamin',
    lastName: 'Sänger',
    notes: '',
    address: address('In der Rödersbach', '61267', 'Neu-Anspach')
  })
  const drummer = await people.create({ firstName: 'Lisa', lastName: 'Drums', notes: '' })
  const tech = await people.create({ firstName: 'Tom', lastName: 'Technik', notes: '' })

  const band = await bands.create({
    name,
    companyId: bandCompany.id,
    managementCompanyId: management.id
  })
  await db.insert(schema.band_member).values([
    { band_id: band.id, person_id: singer.id, role: 'Vocals' },
    { band_id: band.id, person_id: drummer.id, role: 'Drums' },
    { band_id: band.id, person_id: tech.id, role: 'TL' }
  ])

  return {
    service: container.resolve(ManagementContractService),
    band,
    bandCompany,
    management,
    singer,
    drummer,
    tech
  }
}

describe('ManagementContractService', () => {
  it("gives a band's first contract the draft defaults and the band's parties", async () => {
    const { service, band, management, singer, drummer, tech } = await setup('April Art')

    const contract = await service.createForBand(band.id)

    expect(contract.management_company_id).toBe(management.id)
    expect(contract.statement_email).toBe('mgmt@example.com')
    expect(contract.commission_percent).toBe(20)
    expect(contract.term_years).toBe(3)
    expect(contract.renewal_years).toBe(1)
    expect(contract.notice_months).toBe(6)
    expect(contract.territory).toBe('örtlich unbeschränkt')
    expect(contract.excluded_income).toBe('GVL und GEMA Einnahmen')
    expect(contract.post_term_year1_percent).toBe(30)
    expect(contract.memberPersonIds).toEqual([singer.id, drummer.id, tech.id])
    expect(contract.representative_person_id).toBe(singer.id)
  })

  it('copies the latest contract into the next one, newest first', async () => {
    const { service, band, singer, drummer } = await setup('Renewal Band')
    const first = await service.createForBand(band.id)
    await service.update({
      id: first.id,
      commissionPercent: 15,
      termYears: 2,
      memberPersonIds: [singer.id, drummer.id],
      specialClauses: 'Sonderregel'
    })

    const second = await service.createForBand(band.id)

    expect(second.id).not.toBe(first.id)
    expect(second.commission_percent).toBe(15)
    expect(second.term_years).toBe(2)
    expect(second.special_clauses).toBe('Sonderregel')
    expect(second.memberPersonIds).toEqual([singer.id, drummer.id])
    expect((await service.listByBand(band.id)).map((c) => c.id)).toEqual([second.id, first.id])
  })

  it('requires the representative to be one of the listed members', async () => {
    const { service, band, singer, tech } = await setup('Rep Band')
    const contract = await service.createForBand(band.id)

    await expect(
      service.update({
        id: contract.id,
        memberPersonIds: [singer.id],
        representativePersonId: tech.id
      })
    ).rejects.toThrow(/Mitglieder/)
  })

  it('assembles print data with parties, members and the representative address', async () => {
    const { service, band, singer, drummer } = await setup('Print Band')
    const contract = await service.createForBand(band.id)
    await service.update({ id: contract.id, memberPersonIds: [singer.id, drummer.id] })

    const data = await service.getPrintData(contract.id)

    expect(data?.band.name).toBe('Print Band')
    expect(data?.management?.name).toBe('Print Band Management AG')
    expect(data?.management?.city).toBe('Bad Hindelang')
    expect(data?.artist?.name).toBe('Print Band GbR')
    expect(data?.members.map((m) => m.name)).toEqual(['Benjamin Sänger', 'Lisa Drums'])
    expect(data?.representative?.name).toBe('Benjamin Sänger')
    expect(data?.representative?.city).toBe('Neu-Anspach')
  })

  it('falls back to the default own company without band management', async () => {
    const companies = container.resolve(CompanyService)
    const own = await companies.createCompany({
      name: 'Own Default AG',
      isDefaultForInvoicing: true
    })
    const bands = container.resolve(BandRepository)
    const bandCompany = await companies.createCompany({ name: 'Solo GbR' })
    const band = await bands.create({ name: 'Solo', companyId: bandCompany.id })

    const contract = await container.resolve(ManagementContractService).createForBand(band.id)

    expect(contract.management_company_id).toBe(own.id)
    expect(contract.memberPersonIds).toEqual([])
    expect(contract.representative_person_id).toBeNull()
  })
})
