// E2E: Excel export of a filtered list and of all lists (save dialog
// stubbed in main; the written files are read back).
import { test, expect } from '@playwright/test'
import ExcelJS from 'exceljs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let outDir: string

/** Next save dialog answers with this file */
async function saveTo(fileName: string): Promise<string> {
  const file = join(outDir, fileName)
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, file)
  return file
}

test.beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'bookingum-export-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(outDir, { recursive: true, force: true })
})

test('exports the filtered list and all lists', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Spielstätten' }).first().click()
  await page.getByPlaceholder('Spielstätten filtern…').fill('Berg')
  await expect(page.locator('tbody tr')).toHaveCount(1)

  const listFile = await saveTo('Spielstätten.xlsx')
  await page.getByRole('button', { name: 'Exportieren' }).click()
  await expect(page.getByText('1 Zeile exportiert')).toBeVisible()

  const list = new ExcelJS.Workbook()
  await list.xlsx.readFile(listFile)
  const sheet = list.getWorksheet('Spielstätten')!
  expect(sheet.rowCount).toBe(2)
  expect(sheet.getRow(1).getCell(1).value).toBe('Spielstätte')
  expect(sheet.getRow(2).getCell(1).value).toBe('Berghain')

  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Daten' }).click()
  const allFile = await saveTo('Alles.xlsx')
  await page.getByRole('button', { name: 'Alles exportieren…' }).click()
  await expect(page.getByText(/Zeilen exportiert/)).toBeVisible()

  const all = new ExcelJS.Workbook()
  await all.xlsx.readFile(allFile)
  expect(all.worksheets.map((ws) => ws.name)).toEqual([
    'Bands',
    'Personen',
    'Firmen',
    'Spielstätten',
    'Hotels',
    'Events',
    'Rechnungen',
    'Banken'
  ])
  expect(all.getWorksheet('Bands')!.rowCount).toBeGreaterThan(1)
})
