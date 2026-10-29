// E2E: lists scroll as one table – more rows load near the end, column
// headers stay pinned, headers sort (remembered per list), the status line
// counts the matches.
import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { toCsv } from '../../src/main/csv/csv'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

test.beforeAll(async () => {
  // 150 venues (+ 2 seeded) via the import: more than one chunk of 100. The
  // file is ANSI (Windows-1252), as Excel's plain "CSV (Trennzeichen-getrennt)"
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-list-'))
  const file = join(fixtureDir, 'Clubs.csv')
  const rows = [
    ['Venue', 'City', 'cc'],
    ...Array.from({ length: 150 }, (_, i) => [
      `Testclub ${String(i + 1).padStart(3, '0')}`,
      'Köln',
      String((i + 1) * 10)
    ])
  ]
  writeFileSync(file, Buffer.from(toCsv(rows, ';'), 'latin1'))

  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
  const { page } = h
  await page.getByRole('link', { name: 'Spielstätten' }).first().click()
  await page.getByRole('button', { name: 'Importieren' }).click()
  const dialog = page.getByRole('dialog', { name: 'Daten importieren' })
  await dialog.getByRole('button', { name: 'CSV-Datei auswählen…' }).click()
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
  await dialog.getByRole('button', { name: '150 Zeilen importieren' }).click()
  await dialog.getByRole('button', { name: 'Schließen' }).click()
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('scrolls, loads more, sorts and keeps the header in view', async () => {
  const { page } = h
  const status = page.getByRole('status')
  const frame = page.getByTestId('list-scroll')
  const dataRows = page.locator('tbody tr:has(td:nth-child(2))')
  const nameHeader = page.getByRole('columnheader', { name: /Name/ })

  await expect(status).toHaveText('152 Spielstätten')
  await expect(dataRows).toHaveCount(100)
  await expect(page.getByText('100 geladen – weitere beim Scrollen')).toBeVisible()

  // Scrolling to the end loads the rest; the header stays where it was
  const headerTop = (await nameHeader.boundingBox())!.y
  await frame.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(dataRows).toHaveCount(152)
  await expect(page.getByText(/geladen – weitere beim Scrollen/)).toBeHidden()
  expect((await nameHeader.boundingBox())!.y).toBe(headerTop)

  // Sort by capacity, descending: the biggest first
  await page.getByRole('button', { name: /Kapazität/ }).click()
  await expect(page.getByRole('columnheader', { name: /Kapazität/ })).toHaveAttribute(
    'aria-sort',
    'ascending'
  )
  await page.getByRole('button', { name: /Kapazität/ }).click()
  await expect(dataRows.first()).toContainText('Testclub 150')
  await expect(dataRows.first()).toContainText('1.500')

  // Remembered for this list
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page.getByRole('link', { name: 'Spielstätten' }).first().click()
  await expect(page.getByRole('columnheader', { name: /Kapazität/ })).toHaveAttribute(
    'aria-sort',
    'descending'
  )

  // Search narrows the list and says so
  await page.getByPlaceholder('Spielstätten filtern…').fill('Testclub 14')
  await expect(status).toHaveText('10 Spielstätten gefunden')
  await expect(dataRows.first()).toContainText('Testclub 149')
})
