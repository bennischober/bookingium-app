// App settings: defaults, saving, the default own company and backups
// (database snapshot + storage folder + restore note).
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { SettingsService, backupFolderName } from '../src/main/services/SettingsService'
import { CompanyService } from '../src/main/services/CompanyService'
import { setStorageBasePath } from '../src/main/utils/fileStorage'

import { setupTestDb } from './helpers/setup'

setupTestDb()

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bookingum-settings-'))
  setStorageBasePath(join(root, 'userData', 'storage'))
})

afterAll(() => {
  setStorageBasePath(null)
  rmSync(root, { recursive: true, force: true })
})

describe('settings', () => {
  it('fall back to defaults and keep saved values', () => {
    const service = container.resolve(SettingsService)
    expect(service.get()).toEqual({ defaultCountry: 'DE', calendarFeedPath: '' })
    expect(service.update({ defaultCountry: 'AT' })).toMatchObject({ defaultCountry: 'AT' })
    expect(service.update({ defaultCountry: '' })).toMatchObject({ defaultCountry: '' })
    expect(container.resolve(SettingsService).get()).toMatchObject({ defaultCountry: '' })
  })

  it('ignore unreadable stored values', () => {
    db.update(schema.app_setting).set({ value: 'not json' }).run()
    expect(container.resolve(SettingsService).get()).toEqual({
      defaultCountry: 'DE',
      calendarFeedPath: ''
    })
  })

  it('switch the default own company', async () => {
    const companies = container.resolve(CompanyService)
    await companies.createCompany({ name: 'Erste GmbH', isDefaultForInvoicing: true })
    const second = await companies.createCompany({
      name: 'Zweite AG',
      isDefaultForInvoicing: false
    })

    await companies.setDefaultForInvoicing(second.id)
    expect((await companies.getDefaultForInvoicingCompany())?.id).toBe(second.id)
    await companies.setDefaultForInvoicing(null)
    expect(await companies.getDefaultForInvoicingCompany()).toBeNull()
    await expect(companies.setDefaultForInvoicing(99999)).rejects.toThrow('nicht gefunden')
  })
})

describe('backup', () => {
  it('copies database and documents into a dated folder', async () => {
    const storage = join(root, 'userData', 'storage')
    mkdirSync(join(storage, 'documents', 'bands', '1-pretty-wild'), { recursive: true })
    writeFileSync(join(storage, 'documents', 'bands', '1-pretty-wild', 'rider.pdf'), 'rider')
    await container
      .resolve(CompanyService)
      .createCompany({ name: 'Gesichert GmbH', isDefaultForInvoicing: false })

    const date = new Date(2026, 9, 19, 14, 30)
    expect(backupFolderName(date)).toBe('Bookingium-Sicherung 2026-10-19 14-30')
    const target = join(root, 'Sicherungen')
    mkdirSync(target)
    const folder = await container.resolve(SettingsService).createBackup(target, date)

    expect(folder).toBe(join(target, 'Bookingium-Sicherung 2026-10-19 14-30'))
    expect(
      readFileSync(
        join(folder, 'storage', 'documents', 'bands', '1-pretty-wild', 'rider.pdf'),
        'utf-8'
      )
    ).toBe('rider')
    expect(existsSync(join(folder, 'LIESMICH.txt'))).toBe(true)

    const copy = new Database(join(folder, 'bookingum.db'), { readonly: true })
    try {
      const names = copy.prepare('select name from company').all() as Array<{ name: string }>
      expect(names.map((row) => row.name)).toContain('Gesichert GmbH')
    } finally {
      copy.close()
    }
  })
})
