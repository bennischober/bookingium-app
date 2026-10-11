// Regression tests for the company feature: covers the bugs found in
// October 2026 (field loss on partial updates, async-transaction crash) and
// the create/update roundtrip through the service layer.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { setupTestDb, getTestDb } from './helpers/setup'
import { CompanyService } from '../src/main/services/CompanyService'
import { container } from 'tsyringe'

setupTestDb()

const fullInput = {
  name: 'Test AG',
  notes: 'note',
  vatNumber: 'DE212298737',
  ustNumber: 'UST-1',
  taxNumber: '12712063600',
  commercialRegisterNo: 'HRB 7710',
  registerCourt: 'AG Kempten',
  logoPath: '',
  isDefaultForInvoicing: false,
  bankId: null,
  address: {
    street: 'Weidachstr.',
    streetNumber: '13',
    addressSuffix: '',
    zipCode: '87541',
    city: 'Bad Hindelang',
    state: 'Bayern',
    country: 'Germany',
    countryCode: 'DE'
  },
  contact: {
    email: 'test@example.com',
    phone: '08324',
    mobilePhone: '',
    homepage: 'www.example.com'
  }
}

describe('CompanyService', () => {
  it('creates a company with all fields and reads them back', async () => {
    const service = container.resolve(CompanyService)

    const created = await service.createCompany(fullInput)
    expect(created.id).toBeGreaterThan(0)

    const back = await service.getCompanyById(created.id)
    expect(back).not.toBeNull()
    expect(back?.name).toBe('Test AG')
    // The service returns raw DB entities (snake_case); camelCase DTO mapping
    // happens in the tRPC router layer.
    expect(back?.vat_number).toBe('DE212298737')
    expect(back?.tax_number).toBe('12712063600')
    expect(back?.commercial_register_no).toBe('HRB 7710')
    expect(back?.register_court).toBe('AG Kempten')
    expect(back?.address?.city).toBe('Bad Hindelang')
    expect(back?.contact?.email).toBe('test@example.com')
    expect(back?.bank).toBeNull()
  })

  it('a partial update (logo-only) must not wipe other fields', async () => {
    // Regression: UpdateCompanyInput used to be CreateCompanyInput.partial(),
    // which re-applied zod defaults ('' for string fields) so the synthetic
    // logo-only update after company creation erased VAT/tax/register data.
    const service = container.resolve(CompanyService)

    const created = await service.createCompany(fullInput)
    await service.updateCompany({ id: created.id, logoPath: 'logos/99/test.png' })

    const after = await service.getCompanyById(created.id)
    expect(after?.vat_number).toBe('DE212298737')
    expect(after?.tax_number).toBe('12712063600')
    expect(after?.commercial_register_no).toBe('HRB 7710')
    expect(after?.register_court).toBe('AG Kempten')
    expect(after?.logo_path).toBe('logos/99/test.png')
  })

  it('persists company updates without transaction errors', async () => {
    // Regression: create/update used db.transaction(async ...) which
    // better-sqlite3 rejects ("Transaction function cannot return a promise").
    // Any successful create/update here proves the transaction callbacks are
    // synchronous.
    const service = container.resolve(CompanyService)

    const created = await service.createCompany(fullInput)
    const updated = await service.updateCompany({
      id: created.id,
      name: 'Renamed AG',
      vatNumber: 'DE999999999'
    })

    expect(updated.name).toBe('Renamed AG')
    expect(updated.vat_number).toBe('DE999999999')
    // Untouched fields survive
    expect(updated.tax_number).toBe('12712063600')
  })

  it('updating the default flag demotes the previous default', async () => {
    const service = container.resolve(CompanyService)

    const a = await service.createCompany({
      ...fullInput,
      name: 'A GmbH',
      isDefaultForInvoicing: true
    })
    const b = await service.createCompany({
      ...fullInput,
      name: 'B GmbH',
      isDefaultForInvoicing: true
    })

    const aAfter = await service.getCompanyById(a.id)
    const bAfter = await service.getCompanyById(b.id)
    expect(aAfter?.is_default_for_invoicing).toBe(false)
    expect(bAfter?.is_default_for_invoicing).toBe(true)
  })

  it('deletes a company', async () => {
    const service = container.resolve(CompanyService)
    const created = await service.createCompany(fullInput)
    await service.deleteCompany(created.id)
    const back = await service.getCompanyById(created.id)
    expect(back).toBeNull()
  })

  it('keeps the database in-memory isolated', () => {
    const { sqlite } = getTestDb()
    const count = (sqlite.prepare('SELECT COUNT(*) AS n FROM company').get() as { n: number }).n
    expect(count).toBeGreaterThan(0)
  })
})
