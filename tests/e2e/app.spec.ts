// E2E smoke: app boots, navigation works, main pages render.
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle

test.beforeAll(async () => {
  h = await launchApp()
})

test.afterAll(async () => {
  await h.close()
})

test('app boots and shows the dashboard', async () => {
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  expect(true).toBe(true)
})

test('sidebar navigation to Rechnungen works', async () => {
  await h.page.click('text=Rechnungen')
  await h.page.waitForSelector('text=Rechnungsnummerierung', { timeout: 10_000 })
})

test('events list renders and event hub opens', async () => {
  await h.page.click('text=Events')
  await h.page.waitForSelector('table', { timeout: 10_000 })
  // Open the first event row if present
  const firstRow = h.page.locator('table tbody tr').first()
  if ((await firstRow.count()) > 0) {
    await firstRow.click()
    await h.page.waitForSelector('text=Vertrag', { timeout: 10_000 })
  }
})

test('contract print view renders the document', async () => {
  // Navigate via the hash: rebuild the current URL with the print route
  const currentUrl = h.page.url()
  const base = currentUrl.split('#')[0]
  await h.page.goto(`${base}#/events/1/contract/print`)
  await h.page.waitForSelector('text=KONZERTVERTRAG', { timeout: 15_000 })
  // Save a screenshot for visual inspection
  await h.page.screenshot({ path: 'tests/e2e/__screenshots__/contract.png', fullPage: true })
})
