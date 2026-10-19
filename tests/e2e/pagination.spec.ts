// E2E: grid pagination – page size (remembered per grid), jumping to a
// typed page number, first/last page, back in range after a search.
import { test, expect } from '@playwright/test'
import ExcelJS from 'exceljs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

test.beforeAll(async () => {
  // 30 venues (+ 2 seeded) via the import
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-pagination-'))
  const file = join(fixtureDir, 'Venues.xlsx')
  const workbook = new ExcelJS.Workbook()
  workbook
    .addWorksheet('Clubs')
    .addRows([
      ['Venue', 'City'],
      ...Array.from({ length: 30 }, (_, i) => [
        `Testclub ${String(i + 1).padStart(2, '0')}`,
        'Köln'
      ])
    ])
  await workbook.xlsx.writeFile(file)

  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
  const { page } = h
  await page.getByRole('link', { name: 'Spielstätten' }).first().click()
  await page.getByRole('button', { name: 'Importieren' }).click()
  const dialog = page.getByRole('dialog', { name: 'Daten importieren' })
  await dialog.getByRole('button', { name: 'Excel-Datei auswählen…' }).click()
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
  await dialog.getByRole('button', { name: '30 Zeilen importieren' }).click()
  await dialog.getByRole('button', { name: 'Schließen' }).click()
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('pages through a long grid', async () => {
  const { page } = h
  const rows = page.locator('tbody tr')
  const pageInput = page.getByRole('spinbutton', { name: 'Seite' })

  await expect(page.getByText('1–10 von 32')).toBeVisible()
  await expect(pageInput).toHaveAttribute('max', '4')
  await expect(rows).toHaveCount(10)

  // Jump to a typed page
  await pageInput.fill('3')
  await pageInput.press('Enter')
  await expect(page.getByText('21–30 von 32')).toBeVisible()
  // Out of range is clamped to the last page
  await pageInput.fill('99')
  await pageInput.press('Enter')
  await expect(page.getByText('31–32 von 32')).toBeVisible()
  await expect(pageInput).toHaveValue('4')

  await page.getByRole('button', { name: 'Erste Seite' }).click()
  await expect(page.getByText('1–10 von 32')).toBeVisible()

  // Bigger pages, remembered for this grid
  await page.getByRole('combobox', { name: 'Einträge pro Seite' }).click()
  await page.getByRole('option', { name: '25' }).click()
  await expect(page.getByText('1–25 von 32')).toBeVisible()
  await expect(rows).toHaveCount(25)
  await page.getByRole('button', { name: 'Letzte Seite' }).click()
  await expect(page.getByText('26–32 von 32')).toBeVisible()

  await page.getByRole('link', { name: 'Bands' }).first().click()
  await expect(page.getByRole('combobox', { name: 'Einträge pro Seite' })).toHaveText('10')
  await page.getByRole('link', { name: 'Spielstätten' }).first().click()
  await expect(page.getByRole('combobox', { name: 'Einträge pro Seite' })).toHaveText('25')

  // A search with fewer results starts on page 1
  await page.getByRole('button', { name: 'Letzte Seite' }).click()
  await page.getByPlaceholder('Spielstätten filtern...').fill('Testclub 0')
  await expect(page.getByText('1–9 von 9')).toBeVisible()
})
