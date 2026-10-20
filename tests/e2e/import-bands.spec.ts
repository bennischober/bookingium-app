// E2E: a band list imported from Einstellungen – the list type is detected,
// bands of unknown companies are skipped, members land on the band page.
import { test, expect } from '@playwright/test'
import ExcelJS from 'exceljs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-import-bands-'))
  const file = join(fixtureDir, 'Bands.xlsx')
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Künstler').addRows([
    ['Band', 'Genre', 'Firma', 'Mitglieder', 'TL', 'E-Mail'],
    [
      'Neon Harbour',
      'Synthpop',
      'Soundwave Records',
      'Mara Licht (Gesang), Jonas Hafen (Synth)',
      'Erik Kabel',
      'erik@neonharbour.de'
    ],
    ['', '', '', 'Pia Takt (Schlagzeug)'],
    ['Ghost Band', 'Rock', 'Unbekannte GmbH', 'Niemand Hier']
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

test('imports a band list with members from the settings page', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Daten' }).click()
  await page.getByRole('button', { name: 'Daten importieren…' }).click()

  const dialog = page.getByRole('dialog', { name: 'Daten importieren' })
  await dialog.getByRole('button', { name: 'Excel-Datei auswählen…' }).click()
  await expect(dialog.getByRole('combobox', { name: 'Liste enthält' })).toHaveText('Bands')
  await expect(dialog.getByRole('combobox', { name: 'Spalte D übernehmen als' })).toHaveText(
    'Mitglieder'
  )
  await expect(dialog.getByRole('combobox', { name: 'Spalte E übernehmen als' })).toHaveText(
    'Technischer Leiter'
  )
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()

  await expect(dialog.getByText('weitere Mitglieder der Band darüber')).toBeVisible()
  await expect(dialog.getByText('„Unbekannte GmbH“ nicht gefunden')).toBeVisible()
  await expect(dialog.getByText('Erik Kabel (Technischer Leiter)')).toBeVisible()
  await dialog.getByRole('button', { name: '2 Zeilen importieren' }).click()
  await expect(dialog.getByText('1 Band angelegt')).toBeVisible()
  await expect(dialog.getByText('4 Personen angelegt')).toBeVisible()
  await dialog.getByRole('button', { name: 'Schließen' }).click()

  // The band and its members
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await expect(page.locator('tr', { hasText: 'Ghost Band' })).toHaveCount(0)
  await page.locator('tr', { hasText: 'Neon Harbour' }).click()
  await expect(page.getByText('Soundwave Records')).toBeVisible()
  await expect(page.getByText('Erik Kabel')).toBeVisible()
  await page.getByRole('tab', { name: 'Mitglieder' }).click()
  await expect(page.getByText('Mara Licht')).toBeVisible()
  await expect(page.getByText('Pia Takt')).toBeVisible()
  await expect(page.getByText('Schlagzeug')).toBeVisible()

  // Same columns again: the mapping is remembered
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page.getByRole('button', { name: 'Importieren' }).click()
  await dialog.getByRole('button', { name: 'Excel-Datei auswählen…' }).click()
  await expect(dialog.getByText('Zuordnung vom letzten Import')).toBeVisible()
})
