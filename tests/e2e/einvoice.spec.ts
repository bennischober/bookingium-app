// E2E: "Als PDF speichern" on an invoice embeds the e-invoice (factur-x.xml)
// when it is complete (seeded #1040), saves without it and says why when
// not (#1041: recipient without address), and follows the setting.
// The save dialog is stubbed in main; the written PDFs are read back.
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'
import { PDFDocument } from 'pdf-lib'
import { readFacturX } from '../../src/main/einvoice/facturx'

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

/** Leaves the chrome-free print page (no sidebar there) */
async function leavePrintPage() {
  if (h.page.url().includes('/print')) {
    await h.page.getByRole('button', { name: 'Zurück' }).click()
  }
}

/** A toast (not the e-invoice panel, which uses similar words) */
const toast = (text: string) => h.page.locator('[data-sonner-toast]', { hasText: text })

async function openPrintPage(invoiceLabel: string) {
  const { page } = h
  await leavePrintPage()
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await page
    .locator('tr', { hasText: invoiceLabel })
    .getByRole('button', { name: 'Drucken / Als PDF speichern' })
    .click()
  await page.waitForURL(/invoices\/\d+\/print/)
  await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })
}

test.beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'bookingum-einvoice-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(outDir, { recursive: true, force: true })
})

test('embeds the e-invoice into a complete invoice PDF', async () => {
  const { page } = h
  await openPrintPage('#1040')
  await expect(page.getByRole('status', { name: 'E-Rechnung' })).toContainText(
    'E-Rechnung vollständig'
  )

  const file = await saveTo('Rechnung_1040.pdf')
  await page.getByRole('button', { name: 'Als PDF speichern' }).click()
  await expect(toast('PDF mit E-Rechnung gespeichert')).toBeVisible()

  const pdf = new Uint8Array(readFileSync(file))
  const xml = await readFacturX(pdf)
  // Kept for inspection and the KoSIT validator (see einvoice.kosit.test.ts)
  const dir = resolve(process.cwd(), 'tests/e2e/__screenshots__')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'einvoice-1040.pdf'), pdf)
  writeFileSync(resolve(dir, 'einvoice-1040.xml'), xml ?? '')
  expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>')
  expect(xml).toContain('<ram:ID>1040</ram:ID>')
  expect(xml).toContain('<ram:Name>Live Music Berlin GmbH</ram:Name>')
  expect(xml).toContain('<ram:GrandTotalAmount>4200.00</ram:GrandTotalAmount>')
  expect(xml).toContain('<ram:IBANID>DE89370400440532013000</ram:IBANID>')
  // Still the printed invoice, with the Factur-X metadata
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
  expect(Buffer.from(pdf).toString('latin1')).toContain(
    '<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>'
  )
})

test('saves without e-invoice and says what is missing', async () => {
  const { page } = h
  await openPrintPage('#1041')
  const status = page.getByRole('status', { name: 'E-Rechnung' })
  await expect(status).toContainText('Für die E-Rechnung fehlt:')
  await expect(status).toContainText('Rechnungsempfänger: Straße, PLZ, Ort, Land')

  const file = await saveTo('Rechnung_1041.pdf')
  await page.getByRole('button', { name: 'Als PDF speichern' }).click()
  await expect(toast('PDF ohne E-Rechnung gespeichert')).toContainText(
    'Rechnungsempfänger: Straße, PLZ, Ort, Land'
  )
  expect(await readFacturX(new Uint8Array(readFileSync(file)))).toBeNull()
})

test('the setting switches the e-invoice off', async () => {
  const { page } = h
  await leavePrintPage()
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  const toggle = page.getByRole('switch', { name: 'E-Rechnung (ZUGFeRD) in PDF einbetten' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()

  await openPrintPage('#1040')
  await expect(page.getByRole('status', { name: 'E-Rechnung' })).toHaveCount(0)
  const file = await saveTo('Rechnung_1040_ohne.pdf')
  await page.getByRole('button', { name: 'Als PDF speichern' }).click()
  await expect(
    h.page.locator('[data-sonner-toast]').getByText('PDF gespeichert', { exact: true })
  ).toBeVisible()
  expect(await readFacturX(new Uint8Array(readFileSync(file)))).toBeNull()

  await leavePrintPage()
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('switch', { name: 'E-Rechnung (ZUGFeRD) in PDF einbetten' }).click()
})
