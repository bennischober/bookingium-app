// E2E (#225 step 2): a business trip - entered, meals ticked, the live total checked, a receipt
// added to it (open dialog stubbed in main) and the report PDF built.
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { PDFDocument } from 'pdf-lib'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string
const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-trips-'))
  const doc = await PDFDocument.create()
  doc.addPage()
  const hotel = join(fixtureDir, 'Hotel Beispiel.pdf')
  writeFileSync(hotel, await doc.save())
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, hotel)
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('enters a trip, adds a receipt and builds the report', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Reisekosten' }).first().click()
  await expect(page.getByText('Noch keine Reise erfasst.')).toBeVisible()
  await page.getByRole('button', { name: '+ Neue Reise' }).click()

  const dialog = page.getByRole('dialog', { name: 'Neue Reise' })
  await dialog.getByLabel('Name auf der Abrechnung').fill('Erika Beispiel')
  await dialog.getByLabel('Anlass', { exact: true }).fill('Tourbegleitung')
  await dialog.getByLabel('Reiseziel').fill('Musterstadt')
  await dialog.getByLabel('Beginn', { exact: true }).fill('2026-11-03T08:00')
  await dialog.getByLabel('Ende', { exact: true }).fill('2026-11-05T18:00')
  await dialog.getByLabel('04.11.2026 Frühstück gestellt').check()
  await dialog.getByLabel('Gefahrene km (eigenes Fahrzeug)').fill('250')
  // 14 + (28 − 5,60) + 14 = 50,40 € and 250 km × 0,30 € = 75 €
  await expect(dialog.getByText('125,40 €')).toBeVisible()
  await dialog.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Reise gespeichert')).toBeVisible()

  const trip = page.getByRole('dialog', { name: 'Reise bearbeiten' })
  await trip.getByRole('button', { name: 'Neue Belege…' }).click()
  const receipt = page.getByRole('dialog', { name: /Beleg speichern/ })
  await receipt.getByLabel('Betrag (brutto)').fill('120,00')
  await receipt.getByRole('button', { name: 'Speichern' }).click()
  await expect(receipt).toBeHidden()
  await expect(trip.getByText('Hotel Beispiel')).toBeVisible()
  await expect(trip.getByText('245,40 €')).toBeVisible()

  await trip.getByRole('button', { name: 'Abrechnung erstellen' }).click()
  await expect(page.getByText('Abrechnung erstellt')).toBeVisible()
  await expect(
    trip.getByText('Reisekosten 2026-11-03 Erika Beispiel Musterstadt.pdf')
  ).toBeVisible()
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: join(shots, 'trips-dialog.png') })
  await trip.getByRole('button', { name: 'Schließen', exact: true }).click()

  const table = page.getByRole('table', { name: 'Reisen' })
  await expect(table).toContainText('Erika Beispiel')
  await expect(table).toContainText('245,40 €')
})
