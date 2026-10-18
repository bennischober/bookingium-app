// E2E: bill a quarter's management share from a band's management contract
// and print the draft invoice (reference: TNR Managementbeteiligung Q4 2025).
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from './helpers/launch'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

let h: AppHandle

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
})

// Seeded demo band: company Soundwave Records, no own management, so its
// first contract takes the default invoicing company (Live Music Berlin GmbH)
const BAND = 'The Electric Waves'

const billedQuarter = (label: string) =>
  h.page.getByRole('list', { name: 'Abgerechnete Quartale' }).getByRole('listitem').filter({
    hasText: label
  })

test('bills Q4 2025 from the contract as a draft invoice', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page
    .locator('tr', { hasText: BAND })
    .getByRole('button', { name: 'Managementvertrag' })
    .click()
  await page.getByRole('button', { name: '+ Vertrag anlegen' }).click()
  await page.getByRole('button', { name: 'Quartal abrechnen' }).click()

  const dialog = page.getByRole('dialog', { name: 'Managementbeteiligung abrechnen' })
  await dialog.getByRole('combobox', { name: 'Quartal' }).click()
  await page.getByRole('option', { name: '4. Quartal' }).click()
  await dialog.getByLabel('Jahr').fill('2025')
  await dialog.getByLabel('Betrag 1').fill('80.000')
  await dialog.getByRole('button', { name: 'Einnahme' }).click()
  await dialog.getByLabel('Einnahme 2').fill('Merchandise')
  await dialog.getByLabel('Betrag 2').fill('34.217,60')

  // Live preview: 20 % of 114.217,60 € plus 19 % VAT
  const preview = dialog.getByTestId('management-share-preview')
  await expect(preview).toContainText('114.217,60')
  await expect(preview).toContainText('22.843,52')
  await expect(preview).toContainText('4.340,27')
  await expect(preview).toContainText('27.183,79')

  await dialog.getByRole('button', { name: 'Entwurf anlegen' }).click()
  await expect(dialog).toBeHidden()
  const row = billedQuarter('4. Quartal 2025')
  await expect(row).toContainText('22.843,52')
  await expect(row).toContainText('Entwurf')

  // The same quarter cannot be billed twice
  await page.getByRole('button', { name: 'Quartal abrechnen' }).click()
  await dialog.getByRole('combobox', { name: 'Quartal' }).click()
  await page.getByRole('option', { name: '4. Quartal' }).click()
  await dialog.getByLabel('Jahr').fill('2025')
  await dialog.getByLabel('Betrag 1').fill('100')
  await dialog.getByRole('button', { name: 'Entwurf anlegen' }).click()
  await expect(page.getByText('4. Quartal 2025 ist bereits abgerechnet (Entwurf)')).toBeVisible()
  await dialog.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(billedQuarter('4. Quartal 2025')).toHaveCount(1)
})

test('prints the draft like the reference invoice', async () => {
  const { page } = h
  await billedQuarter('4. Quartal 2025').getByRole('button', { name: 'Drucken / PDF' }).click()
  await page.waitForURL(/invoices\/\d+\/print/)

  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Agentur (Deutsch)' }).click()
  await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })
  // One A4 page, no blank second one
  await expect(page.getByText(/DIN A4 · 1 Seite/)).toBeVisible()

  const text = (await page.locator('.paged-source').textContent()) ?? ''
  expect(text).toContain('Soundwave Records') // recipient: the band's company
  expect(text).toContain(BAND) // Künstler
  expect(text).toContain('4. Quartal 2025') // Zeitraum
  expect(text).toContain('Managementbeteiligung 4. Quartal 2025')
  expect(text).toContain('19 %')
  expect(text).toContain('22.843,52')
  expect(text).toContain('4.340,27')
  expect(text).toContain('27.183,79')
  expect(await page.title()).toBe(`Rechnung_Entwurf_${BAND}_Managementbeteiligung 4. Quartal 2025`)

  // Real print output for visual inspection
  const dir = resolve(process.cwd(), 'tests/e2e/__screenshots__')
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, 'management-share.png'), fullPage: true })
  const pdf = await h.printPageToPdf()
  writeFileSync(resolve(dir, 'management-share.pdf'), pdf)
  expect(pdf.length).toBeGreaterThan(10_000)
})
