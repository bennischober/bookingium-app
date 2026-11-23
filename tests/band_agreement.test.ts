// Publishing and label agreements of a band: defaults of a new one, a copy of the latest of the
// same kind, terms merged and checked per kind, and the print data.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandAgreementService } from '../src/main/services/BandAgreementService'
import { BandRepository } from '../src/main/repositories/BandRepository'
import { parseAgreementTerms } from '../src/main/api/schemas/band_agreement.schema'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const address = (street: string, city: string) => ({
  street,
  streetNumber: '1',
  addressSuffix: '',
  zipCode: '10115',
  city,
  state: '',
  country: 'Germany',
  countryCode: 'DE'
})

async function setup(name: string) {
  const companies = container.resolve(CompanyService)
  const bandCompany = await companies.createCompany({
    name: `${name} GbR`,
    address: address('Musterweg', 'Berlin'),
    isDefaultForInvoicing: false
  })
  const publisher = await companies.createCompany({
    name: `${name} Publishing GmbH`,
    address: address('Beispielstraße', 'Hamburg'),
    isDefaultForInvoicing: false
  })
  const band = await container.resolve(BandRepository).create({
    name,
    companyId: bandCompany.id
  })
  return { service: container.resolve(BandAgreementService), band, bandCompany, publisher }
}

describe('agreement terms', () => {
  it('fills every missing field with the template default', () => {
    const terms = parseAgreementTerms('publishing', { advance: 5000 })
    expect(terms.advance).toBe(5000)
    expect(terms.rightsTerm).toBe('statutory')
    expect(terms.printSinglePercent).toBe(10)
    expect(terms.works).toEqual([])
    expect(parseAgreementTerms('label', '{not json').territory).toBe('World')
  })
})

describe('band agreements', () => {
  it('starts a band’s first agreement with the defaults', async () => {
    const { service, band } = await setup('First Band')
    const created = await service.create({ bandId: band.id, kind: 'publishing' })
    expect(created.kind).toBe('publishing')
    expect(created.companyId).toBeNull()
    expect(created.startDate).toBeNull()
    if (created.kind !== 'publishing') throw new Error('kind')
    expect(created.terms.otherLicensePercent).toBe(50)
  })

  it('copies the latest agreement of the same kind, not of the other', async () => {
    const { service, band, publisher } = await setup('Copy Band')
    const first = await service.create({ bandId: band.id, kind: 'publishing' })
    await service.update({
      id: first.id,
      companyId: publisher.id,
      startDate: '2026-11-01',
      specialClauses: 'Extra',
      terms: { authorGemaNumber: '123456', works: [{ title: 'Song A' }] }
    })
    const next = await service.create({ bandId: band.id, kind: 'publishing' })
    expect(next.companyId).toBe(publisher.id)
    expect(next.startDate).toBeNull()
    expect(next.specialClauses).toBe('Extra')
    if (next.kind !== 'publishing') throw new Error('kind')
    expect(next.terms.authorGemaNumber).toBe('123456')
    expect(next.terms.works[0]).toEqual({
      title: 'Song A',
      composer: '',
      lyricist: '',
      publisherShare: ''
    })

    const label = await service.create({ bandId: band.id, kind: 'label' })
    expect(label.companyId).toBeNull()
    expect((await service.listByBand(band.id)).map((a) => a.kind)).toEqual([
      'label',
      'publishing',
      'publishing'
    ])
  })

  it('merges terms over the stored ones and refuses invalid values', async () => {
    const { service, band } = await setup('Terms Band')
    const label = await service.create({ bandId: band.id, kind: 'label' })
    const updated = await service.update({
      id: label.id,
      terms: { physicalRoyalties: [{ from: 0, percent: 22 }], territory: 'Europe' }
    })
    if (updated.kind !== 'label') throw new Error('kind')
    expect(updated.terms.territory).toBe('Europe')
    expect(updated.terms.physicalRoyalties).toEqual([{ from: 0, percent: 22 }])
    expect(updated.terms.sublicensingPercent).toBe(50)
    await expect(
      service.update({ id: label.id, terms: { sublicensingPercent: 150 } })
    ).rejects.toThrow(/Ungültige Vertragsangaben/)
  })

  it('prints with the band company and the counterparty', async () => {
    const { service, band, publisher } = await setup('Print Band')
    const created = await service.create({ bandId: band.id, kind: 'publishing' })
    await service.update({ id: created.id, companyId: publisher.id })
    const data = await service.getPrintData(created.id)
    expect(data?.band.name).toBe('Print Band')
    expect(data?.artist?.name).toBe('Print Band GbR')
    expect(data?.company?.name).toBe('Print Band Publishing GmbH')
    expect(await service.getPrintData(999_999)).toBeNull()
  })

  it('goes with its band', async () => {
    const { service, band } = await setup('Gone Band')
    await service.create({ bandId: band.id, kind: 'label' })
    await container.resolve(BandRepository).delete(band.id)
    expect(await service.listByBand(band.id)).toEqual([])
  })
})
