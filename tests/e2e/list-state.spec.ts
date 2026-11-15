// E2E: a list keeps its search and view while the app is open, and the search palette
// lists the records opened lately ("Zuletzt geöffnet").
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
})

const BAND = 'The Electric Waves'

test('a list keeps its search after a record was opened', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page.getByPlaceholder('Bands filtern…').fill('Electric')
  await page.locator('tr', { hasText: BAND }).first().click()
  await expect(page.getByRole('heading', { name: BAND })).toBeVisible()

  await page.getByRole('button', { name: 'Alle Bands' }).click()
  await expect(page.getByPlaceholder('Bands filtern…')).toHaveValue('Electric')
  await expect(page.locator('tr', { hasText: BAND }).first()).toBeVisible()

  // Also when coming back through the menu; clearing it is remembered too
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await expect(page.getByPlaceholder('Bands filtern…')).toHaveValue('Electric')
  await page.getByPlaceholder('Bands filtern…').fill('')
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await expect(page.getByPlaceholder('Bands filtern…')).toHaveValue('')
})

test('the events page stays on the archive view', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.getByRole('button', { name: 'Archiv', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Archiv' })).toBeVisible()

  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await page.getByRole('link', { name: 'Events' }).first().click()
  await expect(page.getByRole('region', { name: 'Archiv' })).toBeVisible()
  await page.getByRole('button', { name: 'Archiv schließen' }).click()
  await expect(page.getByRole('region', { name: 'Archiv' })).toHaveCount(0)
})

test('the search palette lists the records opened lately', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await page.getByRole('button', { name: 'Alles suchen (Ctrl+K)' }).click()

  const recent = page.getByRole('group', { name: 'Zuletzt geöffnet' })
  // One entry: leaving the band page must not record the list's path under its name
  await expect(recent.getByRole('option')).toHaveCount(1)
  await expect(recent.getByRole('option', { name: new RegExp(BAND) })).toBeVisible()
  await recent.getByRole('option', { name: new RegExp(BAND) }).click()
  await expect(page.getByRole('heading', { name: BAND })).toBeVisible()
})
