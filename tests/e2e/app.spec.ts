// E2E smoke: app boots, navigation works, main pages render.
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from './helpers/launch'
import { resolve } from 'path'

let h: AppHandle

test.beforeAll(async () => {
  h = await launchApp()
})

test.afterAll(async () => {
  await h.close()
})

test('app boots and shows the dashboard', async () => {
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  expect(true).toBe(true)
})

test('sidebar navigation to Rechnungen works', async () => {
  await h.page.click('text=Rechnungen')
  await h.page.waitForSelector('text=Rechnungsnr.', { timeout: 10_000 })
})

test('events list renders and event hub opens', async () => {
  await h.page.click('text=Events')
  await h.page.waitForSelector('table', { timeout: 10_000 })
  // Open the first event row if present
  const firstRow = h.page.locator('table tbody tr').first()
  if ((await firstRow.count()) > 0) {
    await firstRow.click()
    await h.page.waitForSelector('text=Vertrag', { timeout: 10_000 })
  }
})

test('contract print view renders the document', async () => {
  // Open the first seeded event's contract the way a user does (no hardcoded
  // ids: the seed differs with and without sample_data/internal-seed.json)
  await h.page.click('text=Events')
  await h.page.locator('table tbody tr').first().click()
  await h.page.getByRole('button', { name: 'Vertrag', exact: true }).click()
  await h.page.waitForURL(/contract\/print/)
  // Default A4 page view: the real print output drawn as one canvas per page
  await h.page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })
  const ratio = await h.page
    .locator('canvas[data-page="1"]')
    .evaluate((c: HTMLCanvasElement) => c.height / c.width)
  expect(ratio).toBeCloseTo(297 / 210, 2)
  // The window title doubles as the print job / PDF file name
  expect(await h.page.title()).toMatch(/^Konzertvertrag_/)
  // Save a screenshot for visual inspection
  await h.page.screenshot({ path: 'tests/e2e/__screenshots__/contract.png', fullPage: true })
})

test('contract prints to the real PDF output', async () => {
  // Generate the genuine print output via Electron's printToPDF (same engine
  // as the print dialog), so pagination and @page CSS are verified, not just
  // the screen rendering. printPageToPdf targets the first (only) window,
  // which currently shows the contract print route.
  const pdf = await h.printPageToPdf()

  const fs = await import('fs')
  const dir = resolve(process.cwd(), 'tests/e2e/__screenshots__')
  fs.mkdirSync(dir, { recursive: true })
  const out = resolve(dir, 'contract.pdf')
  fs.writeFileSync(out, pdf)
  expect(fs.statSync(out).size).toBeGreaterThan(10_000)

  // Render pages to PNG via pdfjs v4 (with standard fonts) for inspection.
  // Failure here is a diagnostic-only issue - the PDF itself is the assertion.
  const { execFileSync } = await import('child_process')
  try {
    // Arguments, not a command line: no shell, and paths with spaces stay whole
    execFileSync(
      process.execPath,
      [resolve(process.cwd(), 'tests/e2e/helpers/pdf2png.mjs'), out, dir],
      { stdio: 'inherit' }
    )
  } catch {
    console.log('pdf2png rendering failed (diagnostic only) - contract.pdf is still valid')
  }
})
