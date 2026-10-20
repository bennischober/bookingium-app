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
  // Toasts sit over the row buttons at the bottom right until they expire
  await expect(h.page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
}

/** A toast (not the e-invoice panel, which uses similar words) */
const toast = (text: string) => h.page.locator('[data-sonner-toast]', { hasText: text })

/** The list row whose number cell is exactly this ("#1040", not "Storno zu #1040") */
const invoiceRow = (label: string) =>
  h.page.locator('tr').filter({ has: h.page.getByRole('cell', { name: label, exact: true }) })

async function openPrintPage(invoiceLabel: string) {
  const { page } = h
  await leavePrintPage()
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await invoiceRow(invoiceLabel)
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

test('cancelling creates a Stornorechnung with its own e-invoice', async () => {
  const { page } = h
  await leavePrintPage()
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await invoiceRow('#1040').getByRole('button', { name: 'Anzeigen' }).click()
  await page.getByRole('button', { name: 'Stornieren' }).click()
  await page
    .getByRole('dialog', { name: 'Rechnung #1040 stornieren?' })
    .getByRole('button', { name: 'Stornieren' })
    .click()
  const created = toast('Stornorechnung #1042 erstellt')
  await expect(created).toBeVisible()
  await created.getByRole('button', { name: 'Drucken / PDF' }).click()

  await page.waitForURL(/invoices\/\d+\/print/)
  await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })
  const text = (await page.locator('.paged-source').textContent()) ?? ''
  expect(text).toContain('STORNORECHNUNG')
  expect(text).toContain('zu Rechnung Nr. 1040')
  expect(text).toContain('-4.200,00')

  // Agency template: the (negative) VAT line, not the reverse charge note
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Agentur (Deutsch)' }).click()
  await expect(page.locator('.paged-source')).toContainText('zzgl. 19 % USt.:')
  await expect(page.locator('.paged-source')).not.toContainText('Reverse Charge')
  await expect(page.locator('.paged-source')).toContainText(
    'Der Betrag wird mit der Rechnung Nr. 1040 verrechnet.'
  )
  expect(await page.title()).toMatch(/^Stornorechnung_1042_/)
  await expect(page.getByRole('status', { name: 'E-Rechnung' })).toContainText(
    'E-Rechnung vollständig'
  )

  const file = await saveTo('Stornorechnung_1042.pdf')
  await page.getByRole('button', { name: 'Als PDF speichern' }).click()
  await expect(toast('PDF mit E-Rechnung gespeichert')).toBeVisible()
  const pdf = new Uint8Array(readFileSync(file))
  const xml = (await readFacturX(pdf)) ?? ''
  expect(xml).toContain('<ram:ID>1042</ram:ID><ram:TypeCode>381</ram:TypeCode>')
  expect(xml).toContain('<ram:IssuerAssignedID>1040</ram:IssuerAssignedID>')
  expect(xml).toContain('<ram:GrandTotalAmount>4200.00</ram:GrandTotalAmount>')
  const dir = resolve(process.cwd(), 'tests/e2e/__screenshots__')
  writeFileSync(resolve(dir, 'einvoice-storno-1042.pdf'), pdf)
  writeFileSync(resolve(dir, 'einvoice-storno-1042.xml'), xml)

  // The cancelled invoice itself gets no e-invoice any more
  await leavePrintPage()
  await openPrintPage('#1040')
  await expect(page.getByText('Stornierte Rechnungen erhalten keine E-Rechnung')).toBeVisible()
})
