// E2E #289: releases - list, page with tracks, products and rights, the band tab
import { test, expect } from '@playwright/test'
import { resolve } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
const SHOTS = resolve(process.cwd(), 'tests/e2e/__screenshots__')

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
})

test('the seeded release shows its tracks, products and shares', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Releases' }).first().click()
  await expect(page.getByRole('heading', { name: 'Releases' })).toBeVisible()

  // search by a product's UPC
  await page.getByPlaceholder('Titel, Artist, UPC oder ISRC suchen…').fill('036000291452')
  await page.locator('tr', { hasText: 'Static Horizons' }).first().click()

  await expect(page.getByRole('heading', { name: 'Static Horizons' })).toBeVisible()
  await expect(page.getByText('Sample Records').first()).toBeVisible()
  await expect(page.getByText('Mixing Engineer')).toBeVisible()
  await page.screenshot({ path: resolve(SHOTS, 'release-overview.png') }).catch(() => {})

  await page.getByRole('tab', { name: /Tracks/ }).click()
  const tracks = page.getByRole('table', { name: 'Tracks' })
  await expect(tracks).toContainText('Open Circuit')
  await expect(tracks).toContainText('3:21')

  await page.getByRole('tab', { name: /Produkte/ }).click()
  await expect(page.getByRole('heading', { name: 'Vinyl', exact: true })).toBeVisible()
  await expect(page.getByText('Gatefold · Black')).toBeVisible()
  await expect(page.getByText('SAMPLE001V')).toBeVisible()
  await page.screenshot({ path: resolve(SHOTS, 'release-products.png') }).catch(() => {})

  await page.getByRole('tab', { name: 'Rechte' }).click()
  await expect(page.getByText('Max Beispiel').first()).toBeVisible()
})

test('creates a release from the band page and adds a track and a product', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page.locator('tr', { hasText: 'Midnight Symphony' }).first().click()
  await page.getByRole('tab', { name: /Releases/ }).click()
  await page.getByRole('button', { name: 'Neues Release' }).click()

  await page.getByLabel('Titel').fill('Probe Single')
  await page.getByRole('button', { name: 'Anlegen' }).click()

  // the new release opens with the band as artist
  await expect(page.getByRole('heading', { name: 'Probe Single' })).toBeVisible()
  await expect(page.getByText('Midnight Symphony').first()).toBeVisible()

  await page.getByRole('tab', { name: /Tracks/ }).click()
  await page.getByRole('button', { name: 'Track hinzufügen' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Titel', { exact: true }).fill('Erster Song')
  await dialog.getByLabel('ISRC', { exact: true }).fill('XX-0AA-27-00099')
  await dialog.getByLabel('Dauer').fill('3:05')
  await dialog.getByRole('button', { name: 'Urheber hinzufügen' }).click()
  await dialog.getByRole('textbox', { name: 'Name' }).last().fill('Erika Muster')
  await dialog.getByRole('textbox', { name: 'Anteil in Prozent' }).fill('60')
  // shares that do not add up only warn
  await expect(dialog.getByText('ergeben 60 % statt 100 %')).toBeVisible()
  await dialog.getByRole('button', { name: 'Anlegen' }).click()
  await expect(page.getByRole('table', { name: 'Tracks' })).toContainText('XX0AA2700099')

  await page.getByRole('tab', { name: /Produkte/ }).click()
  await page.getByRole('button', { name: 'Produkt hinzufügen' }).click()
  const productDialog = page.getByRole('dialog')
  await productDialog.getByLabel('UPC / EAN').fill('4006381333931')
  await productDialog.getByLabel('Katalognummer').fill('PROBE01D')
  await productDialog.getByRole('button', { name: 'Anlegen' }).click()
  await expect(page.getByText('PROBE01D')).toBeVisible()
  await expect(page.getByText('Erster Song').first()).toBeVisible()
})
