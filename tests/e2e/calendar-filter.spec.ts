// E2E: the calendar shows only some bands or calendars, and keeps that choice
import { test, expect } from '@playwright/test'
import { addDays, format } from 'date-fns'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
})

test('the calendar filters by band and calendar', async () => {
  const { page } = h
  // The demo show of Midnight Symphony is in three days; ?day= opens the calendar on it
  const day = format(addDays(new Date(), 3), 'yyyy-MM-dd')
  await page.evaluate((d) => (window.location.hash = `#/calendar?day=${d}`), day)
  const show = page.getByRole('button', { name: /Midnight Symphony - LA Showcase/ })
  await expect(show.first()).toBeVisible()

  // Only another band: the show disappears
  await page.getByRole('combobox', { name: 'Bands anzeigen' }).click()
  await page.getByRole('option', { name: 'The Electric Waves' }).click()
  await page.keyboard.press('Escape')
  await expect(show).toHaveCount(0)
  await expect(page.getByText('Nur Events der Auswahl.')).toBeVisible()

  // The choice stays when the page is opened again
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await page.evaluate((d) => (window.location.hash = `#/calendar?day=${d}`), day)
  await expect(page.getByRole('combobox', { name: 'Bands anzeigen' })).toContainText(
    'The Electric Waves'
  )
  await expect(show).toHaveCount(0)

  // Reset, then only the appointments calendar: events are out again
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click()
  await expect(show.first()).toBeVisible()
  await page.getByRole('combobox', { name: 'Kalender anzeigen' }).click()
  await page.getByRole('option', { name: 'Termine', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(show).toHaveCount(0)
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click()
  await expect(show.first()).toBeVisible()
})
