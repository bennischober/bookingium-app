// E2E (#228): the event's "Abrechnung" tab reads the promoter's Excel (open dialog stubbed in
// main), checks it against the sheet's own totals, saves it and files the Excel with the event's
// documents.
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { buildXlsx } from '../helpers/xlsx'
import { SETTLEMENT_RECORDS } from '../helpers/settlementSheet'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string
const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-settlement-'))
  const file = join(fixtureDir, 'Veranstaltungsabrechnung Beispielband.xlsx')
  writeFileSync(file, buildXlsx(SETTLEMENT_RECORDS, 'Artist Deutsch'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('reads the promoter settlement, checks and saves it', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.locator('table tbody tr').first().click()
  await page.getByRole('tab', { name: 'Abrechnung' }).click()
  await expect(page.getByText('Noch keine Abrechnung erfasst.')).toBeVisible()

  await page.getByRole('button', { name: 'Excel einlesen…' }).click()
  await expect(page.getByText('die Summen stimmen mit der Excel überein')).toBeVisible()
  await expect(page.getByLabel('Garantie (netto)')).toHaveValue('2.000,00')
  // 4.221,50 € gage less the 500 € advance, plus WKZ and the overnight flat rate
  await expect(page.getByText('4.671,96 €')).toBeVisible()
  mkdirSync(shots, { recursive: true })
  await page.getByText('Ergebnis', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'settlement-result.png') })

  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Abrechnung gespeichert')).toBeVisible()
  await expect(page.getByText('Aus „Veranstaltungsabrechnung Beispielband.xlsx“')).toBeVisible()

  await page.getByRole('tab', { name: /Dokumente/ }).click()
  await expect(page.getByText('Veranstaltungsabrechnung Beispielband.xlsx')).toBeVisible()
})
