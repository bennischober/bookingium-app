// #247: the bank account is typed right in the company form
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { setupTestDb, getTestDb } from './helpers/setup'
import { CompanyService } from '../src/main/services/CompanyService'
import { CreateCompanyInput, UpdateCompanyInput } from '../src/main/api/schemas/company.schema'
import { bank, company } from '../src/main/db/schema'

setupTestDb()

const service = () => container.resolve(CompanyService)
const account = {
  accountHolder: 'Beispiel GmbH',
  iban: 'DE02 1203 0000 0000 2020 51',
  bic: 'BYLADEM1001',
  bankName: 'Beispielbank'
}
const create = (name: string, extra: object = {}) =>
  service().createCompany(CreateCompanyInput.parse({ name, ...extra }))
const update = (id: number, extra: object) =>
  service().updateCompany(UpdateCompanyInput.parse({ id, ...extra }))
const bankOf = (id: number) => {
  const row = getTestDb().db.select().from(company).where(eq(company.id, id)).get()
  return row?.bank_id == null
    ? null
    : getTestDb().db.select().from(bank).where(eq(bank.id, row.bank_id)).get()
}

describe('company bank account (#247)', () => {
  it('stores the account given with a new company, IBAN without spaces', async () => {
    const created = await create('Bank Eins GmbH', { bank: account })
    expect(bankOf(created.id)).toMatchObject({
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
      account_holder: 'Beispiel GmbH',
      bank_name: 'Beispielbank'
    })
  })

  it('rejects an IBAN whose check digits are wrong', () => {
    expect(() =>
      CreateCompanyInput.parse({ name: 'X', bank: { ...account, iban: 'DE03120300000000202051' } })
    ).toThrow(/IBAN/)
  })

  it('changes its own account in place and unlinks it when emptied', async () => {
    const created = await create('Bank Zwei GmbH', { bank: account })
    const before = bankOf(created.id)!
    await update(created.id, { bank: { ...account, bankName: 'Andere Bank' } })
    expect(bankOf(created.id)).toMatchObject({ id: before.id, bank_name: 'Andere Bank' })
    await update(created.id, { bank: { accountHolder: '', iban: '', bic: '', bankName: '' } })
    expect(bankOf(created.id)).toBeNull()
  })

  it('never edits an account another company shares; unchanged keeps the link', async () => {
    const shared = getTestDb().db
      .insert(bank)
      .values({ bank_name: 'Gemeinsam', account_holder: 'A', iban: 'DE89370400440532013000', bic: '' })
      .returning()
      .get()
    const a = await create('Geteilt A', { bankId: shared.id })
    const b = await create('Geteilt B', { bankId: shared.id })
    await update(a.id, {
      bank: { accountHolder: 'A', iban: 'DE89370400440532013000', bic: '', bankName: 'Gemeinsam' }
    })
    expect(bankOf(a.id)?.id).toBe(shared.id)
    await update(a.id, {
      bank: { accountHolder: 'A', iban: 'DE89370400440532013000', bic: '', bankName: 'Neu' }
    })
    expect(bankOf(a.id)?.id).not.toBe(shared.id)
    expect(bankOf(b.id)).toMatchObject({ id: shared.id, bank_name: 'Gemeinsam' })
  })
})
