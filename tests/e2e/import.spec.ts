// E2E: import festivals with their promoters and contacts from an Excel file
// (layout of the Rockfestivals list: month headings, follow-up contact rows).
// The workbook is generated here and the open dialog is stubbed in main.
import { test, expect } from '@playwright/test'
import ExcelJS from 'exceljs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-import-'))
  const file = join(fixtureDir, 'Festivals.xlsx')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('national')
  sheet.addRows([
    [
      'Monat',
      'Festival',
      'Location',
      'Termin/Zeitraum',
      'Zuschauer',
      'Veranstalter',
      'Kontakt',
      'e-Mail',
      'Straße',
      'Haus.Nr.',
      'Plz',
      'Ort',
      'url'
    ],
    ['JUNI'],
    [
      '',
      'Rock am Teich',
      'Teichwiese',
      new Date(Date.UTC(2026, 5, 12)),
      2500,
      'Teich Events GmbH',
      'Paula Teich',
      'paula@teich-events.example.test; info@teich-events.example.test',
      'Seeweg',
      '3',
      '1099',
      'Dresden',
      'www.rock-am-teich.de'
    ],
    ['', '', '', '', '', '', 'Max Ufer', 'max@teich-events.example.test'],
    // Promoter already in the app (seed): linked, not duplicated
    ['', 'Sommerbeben', 'Berlin', '', '800', 'Live Music Berlin GmbH', 'Elke und Johannes']
  ])
  await workbook.xlsx.writeFile(file)

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

test('imports festivals, promoters and contacts from a spreadsheet', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Spielstätten' }).first().click()
  await page.getByRole('button', { name: 'Importieren' }).click()

  const dialog = page.getByRole('dialog', { name: 'Daten importieren' })
  await dialog.getByRole('button', { name: 'Excel-Datei auswählen…' }).click()

  // Mapping detected from the headers; festivals because of the "Festival" column
  await expect(dialog.getByRole('combobox', { name: 'Importieren als' })).toHaveText('Festival')
  await expect(dialog.getByRole('combobox', { name: 'Spalte B übernehmen als' })).toHaveText(
    'Spielstätte / Festival'
  )
  await expect(dialog.getByRole('combobox', { name: 'Spalte G übernehmen als' })).toHaveText(
    'Ansprechpartner'
  )
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()

  await expect(dialog.getByText('2 neu · 0 vorhanden').first()).toBeVisible()
  // Teich Events new, Live Music Berlin from the seed
  await expect(dialog.getByText('1 neu · 1 vorhanden')).toBeVisible()
  await expect(dialog.getByText('weiterer Kontakt zur Zeile darüber')).toBeVisible()
  await expect(dialog.getByText('Rock am Teich (Teichwiese)')).toBeVisible()

  await dialog.getByRole('button', { name: '3 Zeilen importieren' }).click()
  await expect(dialog.getByText('2 Festivals angelegt')).toBeVisible()
  await expect(dialog.getByText('4 Ansprechpartner angelegt')).toBeVisible()
  await dialog.getByRole('button', { name: 'Schließen' }).click()
  await expect(dialog).toBeHidden()

  // Listed as festivals, with the promoter linked
  const row = page.locator('tr', { hasText: 'Rock am Teich' })
  await expect(row).toContainText('Festival')
  await expect(row).toContainText('Teich Events GmbH')
  await expect(row).toContainText('2.500')

  await page.getByRole('combobox', { name: 'Art filtern' }).click()
  await page.getByRole('option', { name: 'Festivals' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)

  // Venue details: festival date in the notes, editable without errors
  await row.getByRole('button', { name: 'Bearbeiten' }).click()
  await expect(page.getByLabel('Anmerkungen')).toHaveValue(
    /Monat: JUNI\nTermin\/Zeitraum: 12\.06\.2026/
  )
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Spielstätte aktualisiert')).toBeVisible()

  // Promoter address with the ZIP code's leading zero restored
  await page.getByRole('link', { name: 'Firmen' }).first().click()
  await expect(page.locator('tr', { hasText: 'Teich Events GmbH' })).toContainText('Dresden')
  await page.getByRole('link', { name: 'Personen' }).first().click()
  await expect(
    page.getByRole('row', { name: /Max Ufer max@teich-events\.example\.test/ })
  ).toBeVisible()

  // A first name alone ("Elke und Johannes") is a valid person
  await page
    .getByRole('row', { name: /^Elke / })
    .getByRole('button', { name: 'Bearbeiten' })
    .click()
  await page.getByRole('button', { name: /speichern/i }).click()
  await expect(page.getByText(/aktualisiert/).first()).toBeVisible()
})
