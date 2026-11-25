// E2E: a band's Marketing-Atlas imported from a file with a chosen working list, an entry taken
// from the pool and back, a status set, and the created media company showing the band's entry.
// Fictitious data only.
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
  // the measures come first, the atlas second
  const views = page.getByRole('group', { name: 'Marketing' }).getByRole('button')
  await expect(views).toHaveText(['Maßnahmen', 'Atlas'])
  await expect(page.getByRole('button', { name: 'Maßnahmen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByText('Noch keine Maßnahmen.')).toBeVisible()
  await page.getByRole('button', { name: 'Atlas', exact: true }).click()
  await expect(page.getByText(`Noch kein Marketing-Atlas für ${BAND}`)).toBeVisible()

  await page.getByRole('button', { name: 'Marketing-Atlas importieren…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Marketing-Atlas importieren' })
  await dialog.getByRole('button', { name: 'Datei wählen…' }).click()
  await expect(dialog.getByText('5 Einträge')).toBeVisible()
  // A entries (and the running relationship) are suggested; B and C wait in the pool
  await expect(dialog.getByText('3 von 5 ausgewählt')).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /Probe Rock FM/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /Kleines Probe-Radio/ })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: /Probe Classic Radio/ }).check()
  await expect(dialog.getByText('4 von 5 ausgewählt')).toBeVisible()
  await dialog.getByLabel('Je Reiter einen Verteiler anlegen').check()
  await page.screenshot({ path: join(shots, 'marketing-import-pick.png') })
  await dialog.getByRole('button', { name: 'Importieren' }).click()
  await expect(dialog).toBeHidden()

  // Only the working list is shown; the C entry waits in the atlas
  await expect(
    page.getByText('Stand 18.11.2026 · Lauf 3 · 4 auf der Liste · 1 weitere im Atlas')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^Probe Rock FM/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Probe Classic Radio/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Kleines Probe-Radio/ })).toBeHidden()
  // the picked radios became media companies
  await expect(page.getByRole('link', { name: 'Probe Rock FM' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Als Kontakt anlegen' })).toHaveCount(0)

  // Taken from the pool later, and back off the list
  await page.getByRole('button', { name: 'Auswahl bearbeiten…' }).click()
  const pick = page.getByRole('dialog', { name: 'Auswahl bearbeiten' })
  await pick.getByRole('checkbox', { name: /Kleines Probe-Radio/ }).check()
  await expect(pick.getByText('5 von 5 ausgewählt · 1 dazu')).toBeVisible()
  await pick.getByRole('button', { name: 'Speichern' }).click()
  await expect(pick).toBeHidden()
  await expect(page.getByRole('link', { name: 'Kleines Probe-Radio' })).toBeVisible()
  await page.getByRole('button', { name: /^Kleines Probe-Radio/ }).click()
  await page.getByRole('button', { name: 'Von der Liste nehmen' }).click()
  await expect(page.getByRole('button', { name: /^Kleines Probe-Radio/ })).toBeHidden()
  await expect(page.getByText(/1 weitere im Atlas/)).toBeVisible()

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

  // A radio spot booked from the atlas entry: partner and entry are filled in
  await page.getByRole('button', { name: 'Maßnahme', exact: true }).first().click()
  const action = page.getByRole('dialog', { name: 'Neue Maßnahme' })
  await expect(action.getByLabel('Bezeichnung')).toHaveValue('Probe Rock FM')
  await action.getByLabel('Bezeichnung').fill('Spot 20 s Tourvorbericht')
  await action.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Gebucht' }).click()
  await action.getByLabel('Kosten netto (€)').fill('1.200,00')
  await action.getByRole('button', { name: 'Anlegen' }).click()
  await expect(action).toBeHidden()
  await expect(page.getByText('Maßnahme: Gebucht')).toBeVisible()

  await page.getByRole('button', { name: 'Maßnahmen', exact: true }).click()
  await expect(page.getByText('Spot 20 s Tourvorbericht')).toBeVisible()
  await expect(page.getByText(/1 Maßnahme · Kosten 1.200,00/)).toBeVisible()
  await page.screenshot({ path: join(shots, 'marketing-actions.png'), fullPage: true })

  // with an atlas, reopening the tab still lands on the measures
  await page.getByRole('tab', { name: 'Übersicht' }).click()
  await page.getByRole('tab', { name: 'Marketing' }).click()
  await expect(page.getByRole('button', { name: 'Maßnahmen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByText('Spot 20 s Tourvorbericht')).toBeVisible()

  await page.getByRole('link', { name: 'Probe Rock FM' }).first().click()
  await expect(page.getByText('Marketing', { exact: true })).toBeVisible()
  await expect(page.getByText('Spot 20 s Tourvorbericht')).toBeVisible()
  await expect(page.getByText(/Radios · Priorität A · Angefragt/)).toBeVisible()

  // the band's atlas entry links straight to the atlas view
  await page.getByRole('link', { name: BAND }).first().click()
  await expect(page.getByRole('button', { name: 'Atlas', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByRole('button', { name: /^Probe Rock FM/ })).toBeVisible()
})
