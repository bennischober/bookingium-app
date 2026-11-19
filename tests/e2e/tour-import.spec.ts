// E2E: Tourdaten importieren - an Excel tour sheet becomes own events with their tour, an
// unknown club is created, the event list filters by tour, and the map lists the shows with
// their radius clause. Fictitious data only.
import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildXlsx, buildXlsxSheets } from '../helpers/xlsx'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

/** Excel's date serial of a day `offset` days from today */
const serialInDays = (offset: number): number => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86_400_000)
}

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-tour-'))
  const file = join(fixtureDir, 'Tourplan.xlsx')
  writeFileSync(
    file,
    buildXlsx([
      ['Datum', 'Künstler', 'Location', 'PLZ', 'Stadt', 'Status', 'Gage', 'Gebietsschutz'],
      [
        { date: serialInDays(90) },
        'The Electric Waves',
        'Halle Muster',
        { zip: 50667 },
        'Köln',
        'fix',
        1200,
        80
      ],
      [
        { date: serialInDays(92) },
        'The Electric Waves',
        'Club Beispiel',
        { zip: 1067 },
        'Dresden',
        'Option',
        '',
        ''
      ]
    ])
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

test('imports a tour sheet as events and filters the list by tour', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.getByRole('button', { name: 'Tourdaten importieren' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tourdaten importieren' })
  await dialog.getByRole('button', { name: 'Datei auswählen…' }).click()
  await dialog.getByLabel('Tour', { exact: true }).fill('Testtour 2027')
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
  await expect(dialog.getByText('wird angelegt').first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Importieren' }).click()
  await expect(dialog.getByText(/2 neu/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click()

  await page.getByRole('combobox', { name: 'Tour' }).click()
  await page.getByRole('option', { name: 'Testtour 2027' }).click()
  await expect(page.getByText('The Electric Waves – Halle Muster')).toBeVisible()
  await expect(page.getByText('The Electric Waves – Club Beispiel')).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(3)
})

test('imports the chosen sheet of a workbook from the top bar, weekday column left out', async () => {
  const { page } = h
  const file = join(fixtureDir, 'Tourliste.xlsx')
  writeFileSync(
    file,
    buildXlsxSheets([
      {
        name: 'Notizen',
        rows: [
          ['Thema', 'Notiz'],
          ['Hotel', 'noch offen']
        ]
      },
      {
        name: 'Ticketkontingent',
        rows: [
          ['Tag', 'Datum', 'City', 'Club', 'Anfangsbestand'],
          [],
          ['FR', { date: serialInDays(120) }, 'Leipzig', 'Club Probe', 200],
          ['SA', { date: serialInDays(121) }, 'Hamburg', 'Halle Beispiel', 300]
        ]
      }
    ])
  )
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)

  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Tourdaten' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tourdaten importieren' })
  await dialog.getByRole('button', { name: 'Datei auswählen…' }).click()
  // The sheet with show dates is opened, not the first one
  await expect(dialog.getByRole('combobox', { name: 'Tabellenblatt' })).toHaveText(
    'Blatt „Ticketkontingent“'
  )
  await expect(dialog.getByRole('combobox', { name: 'Spalte A übernehmen als' })).toHaveText(
    'Nicht importieren'
  )
  await expect(dialog.getByRole('combobox', { name: 'Spalte B übernehmen als' })).toHaveText(
    'Datum'
  )
  await dialog.locator('#tour-import-band').click()
  await page.getByRole('option', { name: 'The Electric Waves' }).click()
  await dialog.getByLabel('Tour', { exact: true }).fill('Kontingent 2027')
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
  await expect(dialog.getByLabel('Zusammenfassung')).toContainText('2 neu')
  await dialog.getByRole('button', { name: 'Importieren' }).click()
  await expect(dialog.getByText(/2 neu/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click()
})
