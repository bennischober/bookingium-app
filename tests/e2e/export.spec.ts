// E2E: CSV export of a filtered list and of all lists (save and folder
// dialogs stubbed in main; the written files are read back).
import { test, expect } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { decodeCsv, parseCsv } from '../../src/main/csv/csv'
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

/** Records of a written CSV (separator detected, as the import does) */
function readCsv(file: string): string[][] {
  return parseCsv(decodeCsv(readFileSync(file)), ';')
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
  await page.getByRole('link', { name: 'Clubs' }).first().click()
  await page.getByPlaceholder('Clubs filtern…').fill('Berg')
  await expect(page.locator('tbody tr')).toHaveCount(1)

  const listFile = await saveTo('Clubs.csv')
  await page.getByRole('button', { name: 'Exportieren' }).click()
  await expect(page.getByText('1 Zeile exportiert')).toBeVisible()

  // UTF-8 with BOM, so Excel shows the umlauts
  expect([...readFileSync(listFile).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const list = readCsv(listFile)
  expect(list).toHaveLength(2)
  expect(list[0][0]).toBe('Club / Festival')
  expect(list[1][0]).toBe('Berghain')

  // All lists: one file each in a new folder inside the chosen one
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Daten' }).click()
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, outDir)
  await page.getByRole('button', { name: 'Alles exportieren…' }).click()
  await expect(page.getByText(/Zeilen exportiert/)).toBeVisible()

  const [folder] = readdirSync(outDir).filter((name) => name.startsWith('Bookingium Export'))
  expect(readdirSync(join(outDir, folder)).sort()).toEqual(
    [
      'Bands',
      'Banken',
      'Events',
      'Firmen',
      'Hotels',
      'Personen',
      'Rechnungen',
      'Clubs und Festivals'
    ]
      .map((name) => `${name}.csv`)
      .sort()
  )
  expect(readCsv(join(outDir, folder, 'Bands.csv')).length).toBeGreaterThan(1)
})
