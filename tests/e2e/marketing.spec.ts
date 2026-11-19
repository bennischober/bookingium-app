// E2E: a band's Marketing-Atlas imported from a file, filtered, a status set, and the created
// media company showing the band's entry. Fictitious data only.
import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string
const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')
const BAND = 'The Electric Waves'

const entry = (name: string, category: string, priority: string, extra: object = {}) => ({
  name,
  category,
  priority,
  group: 'DACH',
  country: 'DE',
  type: 'Rockradio',
  reason: `${name} spielt Bands aus dem Umfeld.`,
  approach: 'Über die Musikredaktion.',
  timing: 'zur Tour',
  quality: 'b',
  url: 'https://quelle.example.test/playlist',
  ...extra
})

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-marketing-'))
  const file = join(fixtureDir, 'Electric Waves.bookingium-atlas.json')
  writeFileSync(
    file,
    JSON.stringify({
      format: 'bookingium-marketing-atlas',
      version: 1,
      band: BAND,
      stand: '18.11.2026',
      run: 3,
      lead: 'Rock mit Stadion-Energie.',
      facts: [['Sound', 'Rock mit Stadion-Energie.']],
      items: [
        entry('Probe Rock FM', 'radios', 'A'),
        entry('Probe Classic Radio', 'radios', 'B'),
        entry('Kleines Probe-Radio', 'radios', 'C'),
        entry('Probe Open Air', 'festivals', 'A', {
          type: 'Festival',
          contact: { email: 'booking@openair.example.test', note: 'Nur Links schicken.' }
        }),
        entry('Probe-Podcast', 'podcasts', 'A', { activeNote: 'Interview im Oktober' })
      ]
    })
  )
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

test('imports a Marketing-Atlas into a band and links its contacts', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page.locator('tr', { hasText: BAND }).first().click()
  await page.getByRole('tab', { name: 'Marketing' }).click()
  await expect(page.getByText(`Noch kein Marketing-Atlas für ${BAND}`)).toBeVisible()

  await page.getByRole('button', { name: 'Marketing-Atlas importieren…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Marketing-Atlas importieren' })
  await dialog.getByRole('button', { name: 'Datei wählen…' }).click()
  await expect(dialog.getByText('5 Einträge')).toBeVisible()
  await dialog.getByLabel('Je Reiter einen Verteiler anlegen').check()
  await dialog.getByRole('button', { name: 'Importieren' }).click()
  await expect(dialog).toBeHidden()

  // Top picks of the first tab; the C entry only under "Alle"
  await expect(page.getByText('Stand 18.11.2026 · Lauf 3 · 5 Einträge')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Probe Rock FM/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Probe Classic Radio/ })).toBeHidden()
  await page.getByRole('button', { name: 'Alle', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Kleines Probe-Radio/ })).toBeVisible()
  // A and B became media companies; C stays without a contact
  await expect(page.getByRole('link', { name: 'Probe Rock FM' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Als Kontakt anlegen' })).toHaveCount(1)

  // The existing relationship starts as "Läuft schon"
  await page.getByRole('tab', { name: /Podcasts/ }).click()
  await expect(page.getByRole('combobox', { name: 'Status von Probe-Podcast' })).toHaveText(
    'Läuft schon'
  )

  // Status of the radio, then the company page shows the band's entry
  await page.getByRole('tab', { name: /Radios/ }).click()
  await page.getByRole('combobox', { name: 'Status von Probe Rock FM' }).click()
  await page.getByRole('option', { name: 'Angefragt' }).click()
  await expect(page.getByRole('combobox', { name: 'Status von Probe Rock FM' })).toHaveText(
    'Angefragt'
  )
  await page.getByRole('button', { name: /^Probe Rock FM/ }).click()
  await expect(page.getByText('Über die Musikredaktion.')).toBeVisible()
  await page.screenshot({ path: join(shots, 'marketing-tab.png'), fullPage: true })

  await page.getByRole('link', { name: 'Probe Rock FM' }).click()
  await expect(page.getByText('Marketing-Atlas', { exact: true })).toBeVisible()
  await expect(page.getByText(/Radios · Priorität A · Angefragt/)).toBeVisible()
})
