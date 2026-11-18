// E2E (#222): "Aus E-Rechnung" on the company list. A Factur-X PDF is generated here, the open
// dialog is stubbed in main; the preview is checked, a person added, and the company page
// shows what was written.
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { PDFDocument } from 'pdf-lib'
import { embedFacturX } from '../../src/main/einvoice/facturx'
import { CII_INVOICE } from '../helpers/receivedEInvoices'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string
const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-einvoice-'))
  const doc = await PDFDocument.create()
  doc.addPage()
  const pdf = await embedFacturX(await doc.save(), CII_INVOICE, { title: 'Rechnung' })
  const file = join(fixtureDir, 'Eingangsrechnung.pdf')
  writeFileSync(file, pdf)

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

test('creates a company and its people from an e-invoice', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Firmen' }).first().click()
  await page.getByRole('button', { name: 'Aus E-Rechnung' }).click()

  const dialog = page.getByRole('dialog', { name: 'Firma aus E-Rechnung' })
  await dialog.getByRole('button', { name: 'Datei wählen…' }).click()

  await expect(dialog.getByText('wird neu angelegt')).toBeVisible()
  await expect(dialog.getByText('Rechnung RE-2026-0042')).toBeVisible()
  await expect(dialog.getByLabel('Firmenname')).toHaveValue('Bühnentechnik Beispiel GmbH & Co. KG')
  await expect(dialog.getByLabel('USt-IdNr.')).toHaveValue('DE123456789')
  await expect(dialog.getByLabel('Vorname')).toHaveCount(3)
  await expect(dialog.getByLabel('Rolle').first()).toHaveValue('Kontakt')

  await dialog.getByRole('button', { name: 'Person hinzufügen' }).click()
  await dialog.getByLabel('Vorname').nth(3).fill('Paul')
  await dialog.getByLabel('Nachname').nth(3).fill('Ergänzt')
  await expect(dialog.getByLabel('Rolle').nth(3)).toHaveValue('Geschäftsführer')

  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: join(shots, 'company-einvoice-preview.png') })

  await dialog.getByRole('button', { name: 'Firma anlegen' }).click()
  await expect(dialog).toBeHidden()

  // The new company's page
  await expect(
    page.getByRole('heading', { name: 'Bühnentechnik Beispiel GmbH & Co. KG' })
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Ansprechpartner' }).click()
  for (const name of ['Lena Kontaktfrau', 'Erika Beispiel', 'Max Probe', 'Paul Ergänzt']) {
    await expect(page.getByText(name)).toBeVisible()
  }
  await page.screenshot({ path: join(shots, 'company-einvoice-contacts.png') })

  // The same invoice again: the company is found by its VAT id
  await page.getByRole('link', { name: 'Firmen' }).first().click()
  await page.getByRole('button', { name: 'Aus E-Rechnung' }).click()
  await dialog.getByRole('button', { name: 'Datei wählen…' }).click()
  await expect(dialog.getByText(/Vorhanden: .* \(gefunden über USt-IdNr\.\)/)).toBeVisible()
  await expect(dialog.getByText('bereits zugeordnet')).toHaveCount(3)
  await expect(dialog.getByRole('button', { name: 'Firma ergänzen' })).toBeVisible()
})
