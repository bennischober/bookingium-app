// E2E: an issued invoice (seeded #1040) prints the EPC payment QR code; the
// code in the saved PDF is rendered and scanned like a banking app would, and
// the setting switches it off. The save dialog is stubbed in main.
import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createCanvas, loadImage } from 'canvas'
import jsQR from 'jsqr'
import { launchApp, type AppHandle } from './helpers/launch'
import { isValidIban } from '../../src/main/payment/epcQr'

let h: AppHandle
let outDir: string

async function saveTo(fileName: string): Promise<string> {
  const file = join(outDir, fileName)
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, file)
  return file
}

async function openPrintPage(invoiceLabel: string) {
  const { page } = h
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await page
    .locator('tr')
    .filter({ has: page.getByRole('cell', { name: invoiceLabel, exact: true }) })
    .getByRole('button', { name: 'Drucken / Als PDF speichern' })
    .click()
  await page.waitForURL(/invoices\/\d+\/print/)
  await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })
}

async function leavePrintPage() {
  if (h.page.url().includes('/print')) {
    await h.page.getByRole('button', { name: 'Zurück' }).click()
  }
}

/** Renders the PDF's first page (pdf.js, 144 dpi) and scans it for a QR code */
async function scanFirstPage(pdfFile: string): Promise<string | null> {
  const pngDir = mkdtempSync(join(outDir, 'png-'))
  execFileSync(process.execPath, [
    resolve(process.cwd(), 'tests/e2e/helpers/pdf2png.mjs'),
    pdfFile,
    pngDir
  ])
  const image = await loadImage(join(pngDir, readdirSync(pngDir).sort()[0]))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, image.width, image.height)
  return jsQR(data, image.width, image.height)?.data ?? null
}

test.beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'bookingum-payment-qr-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(outDir, { recursive: true, force: true })
})

test('an issued invoice carries a scannable payment QR code', async () => {
  const { page } = h
  await openPrintPage('#1040')
  await expect(page.getByTestId('payment-qr')).toHaveCount(1)

  const file = await saveTo('Rechnung_1040.pdf')
  await page.getByRole('button', { name: 'Als PDF speichern' }).click()
  await expect(page.locator('[data-sonner-toast]', { hasText: 'gespeichert' })).toBeVisible()

  const text = await scanFirstPage(file)
  expect(text).not.toBeNull()
  const lines = text!.split('\n')
  expect(lines.slice(0, 4)).toEqual(['BCD', '002', '1', 'SCT'])
  expect(isValidIban(lines[6])).toBe(true)
  expect(lines[7]).toMatch(/^EUR\d+\.\d{2}$/)
  expect(lines[10]).toMatch(/^(Rechnung|Invoice) 1040$/)
})

test('the setting switches the QR code off', async () => {
  const { page } = h
  await leavePrintPage()
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Rechnungen' }).click()
  const toggle = page.getByRole('switch', { name: 'QR-Code zum Bezahlen auf Rechnungen' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()

  await openPrintPage('#1040')
  await expect(page.getByTestId('payment-qr')).toHaveCount(0)

  await leavePrintPage()
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Rechnungen' }).click()
  await page.getByRole('switch', { name: 'QR-Code zum Bezahlen auf Rechnungen' }).click()
})
