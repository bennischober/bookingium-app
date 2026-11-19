// E2E (#232): a ticket quota sheet imported for a tour, the tour overview with a sales report
// typed in, then advancing and tickets on the event's own tabs. Fictitious data only.
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { buildXlsxSheets } from '../helpers/xlsx'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string
const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')

/** Excel's date serial of a day `offset` days from today */
const serialInDays = (offset: number): number => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86_400_000)
}

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-advancing-'))
  const file = join(fixtureDir, 'Tourliste.xlsx')
  writeFileSync(
    file,
    buildXlsxSheets([
      {
        name: 'Ticketkontingent',
        rows: [
          ['Tag', 'Datum', 'City', 'Club', 'Anfangsbestand', 'verkauft'],
          [],
          ['FR', { date: serialInDays(60) }, 'Leipzig', 'Club Probe', 200, 80],
          ['SA', { date: serialInDays(61) }, 'Hamburg', 'Halle Beispiel', 'warten auf Bestätigung']
        ]
      }
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

test('imports a quota sheet, reports sales on the tour page and advances a show', async () => {
  const { page } = h
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Tourdaten' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tourdaten importieren' })
  await dialog.getByRole('button', { name: 'Datei auswählen…' }).click()
  await expect(dialog.getByRole('combobox', { name: 'Spalte E übernehmen als' })).toHaveText(
    'Ticketkontingent'
  )
  await dialog.locator('#tour-import-band').click()
  await page.getByRole('option', { name: 'The Electric Waves' }).click()
  await dialog.getByLabel('Tour', { exact: true }).fill('Kontingenttour')
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
  await expect(dialog.getByText('Kontingent 200 · 80 verkauft')).toBeVisible()
  await dialog.getByRole('button', { name: 'Importieren' }).click()
  await expect(dialog.getByText(/2 neu/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click()

  // The tour at a glance; today's sales typed straight into the row
  await page.getByRole('link', { name: 'Touren' }).first().click()
  const table = page.getByRole('table', { name: 'Shows der Tour' })
  await expect(table).toContainText('Leipzig')
  await expect(table).toContainText('warten auf Bestätigung')
  await expect(page.getByLabel('Tour-Summe')).toContainText('80 von 200 (40 %)')
  const quick = table.getByRole('textbox', { name: 'Verkauft heute Leipzig' })
  await quick.fill('130')
  await quick.press('Enter')
  await expect(page.getByLabel('Tour-Summe')).toContainText('130 von 200 (65 %)')
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: join(shots, 'tour-overview.png') })

  // Advancing on the event
  await table.getByRole('button', { name: 'Club Probe' }).click()
  await page.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Angeschrieben' }).click()
  await page.getByLabel('Offene Punkte / Notizen').fill('Load-in 16 Uhr, Parken hinten')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Advancing gespeichert')).toBeVisible()
  await page.screenshot({ path: join(shots, 'event-advancing.png') })

  // Tickets on the event: both reports, the change between them
  await page.getByRole('tab', { name: 'Geld' }).click()
  await expect(page.getByText('von 200 · 65 % · 70 übrig')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Meldungen' })).toContainText('130')
  await page.screenshot({ path: join(shots, 'event-tickets.png') })

  await page.getByRole('link', { name: 'Touren' }).first().click()
  await expect(table.getByText('Angeschrieben')).toBeVisible()
})
