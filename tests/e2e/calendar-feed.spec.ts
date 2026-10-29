// E2E: the calendar file chosen in Einstellungen is written right away and
// rewritten by itself after a change in the app.
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let outDir: string

test.beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'bookingum-calendar-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(outDir, { recursive: true, force: true })
})

test('keeps the calendar file up to date', async () => {
  const { page } = h
  const file = join(outDir, 'Bookingium.ics')
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, file)

  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Kalender' }).click()
  await page.getByRole('button', { name: 'Datei festlegen…' }).click()
  await expect(page.getByText('Kalender-Datei wird jetzt aktuell gehalten')).toBeVisible()
  await expect(page.getByText(/Zuletzt geschrieben .* · 3 Events/)).toBeVisible()

  const ics = () => (existsSync(file) ? readFileSync(file, 'utf-8').replace(/\r\n /g, '') : '')
  expect(ics()).toContain('SUMMARY:The Electric Waves - Berlin Tour')
  expect(ics()).toContain('LOCATION:Berghain')

  // Renaming the venue rewrites the file
  await page.getByRole('link', { name: 'Clubs' }).first().click()
  await page
    .locator('tr', { hasText: 'Berghain' })
    .getByRole('button', { name: 'Bearbeiten' })
    .click()
  await page.getByLabel('Name').fill('Berghain Halle')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect.poll(ics, { timeout: 10_000 }).toContain('LOCATION:Berghain Halle')

  // Off: the setting is cleared, the file stays
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Kalender' }).click()
  await page.getByRole('button', { name: 'Ausschalten' }).click()
  await expect(page.getByText('Aus – keine Kalender-Datei festgelegt.')).toBeVisible()
  expect(existsSync(file)).toBe(true)
})
