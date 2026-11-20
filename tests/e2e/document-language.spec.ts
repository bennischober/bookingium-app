// E2E: every outgoing document prints in German or English, picked on its print page.
// Seeded #1040 goes to a recipient in the US, so it opens as an English Geschäftsbrief with a
// hint on the tax code; the saved PDF is read back. A concert contract has the same switch.
import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let outDir: string

async function saveTo(fileName: string): Promise<string> {
  const file = join(outDir, fileName)
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, file)
  return file
}

function pdfText(file: string): string {
  return execFileSync(
    process.execPath,
    [resolve(process.cwd(), 'tests/e2e/helpers/pdf-text.mjs'), file, '--all'],
    { encoding: 'utf8' }
  ).replace(/\s+/g, ' ')
}

test.beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'bookingum-document-language-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(outDir, { recursive: true, force: true })
})

test('prints an English Geschäftsbrief invoice for a recipient abroad', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await page
    .locator('tr')
    .filter({ has: page.getByRole('cell', { name: '#1040', exact: true }) })
    .getByRole('button', { name: 'Drucken / Als PDF speichern' })
    .click()
  await page.waitForURL(/invoices\/\d+\/print/)
  await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })

  // Layout and language are separate choices; the language follows the recipient's country
  await expect(page.getByRole('combobox', { name: 'Vorlage' })).toHaveText('Geschäftsbrief')
  const language = page.getByRole('combobox', { name: 'Sprache des Dokuments' })
  await expect(language).toHaveText('Englisch (EN)')

  const sheet = page.locator('.paged-source')
  await expect(sheet).toContainText('Invoice no.: 1040')
  await expect(sheet).toContainText('Total amount:')
  await expect(sheet).toContainText('Description')
  await expect(sheet).not.toContainText('Rechnung')
  await expect(sheet).not.toContainText('Endbetrag')
  expect(await page.title()).toMatch(/^Invoice_1040_/)

  // A hint, never a decision: German VAT on a recipient outside the EU
  const hint = page.getByRole('status', { name: 'Hinweis zur Rechnung ins Ausland' })
  await expect(hint).toContainText('„nicht steuerbar“')
  await expect(hint).toContainText('entscheidet Ihr Steuerberater')

  const file = await saveTo('Invoice_1040.pdf')
  await page.getByRole('button', { name: 'Als PDF speichern' }).click()
  await expect(page.locator('[data-sonner-toast]', { hasText: 'gespeichert' })).toBeVisible()
  const text = pdfText(file)
  expect(text).toContain('Invoice')
  expect(text).toContain('Total amount:')
  expect(text).not.toContain('Rechnung')
  expect(text).not.toContain('Endbetrag')

  // Back to German: the same layout in German, and the hint offers English again
  await language.click()
  await page.getByRole('option', { name: 'Deutsch (DE)' }).click()
  await expect(sheet).toContainText('Rechnungs-Nr.: 1040')
  await expect(sheet).toContainText('Endbetrag:')
  expect(await page.title()).toMatch(/^Rechnung_1040_/)
  await hint.getByRole('button', { name: 'Englisch verwenden' }).click()
  await expect(language).toHaveText('Englisch (EN)')
  await expect(sheet).toContainText('Invoice no.: 1040')
})

test('prints a contract in English and German', async () => {
  const { page } = h
  await page.getByRole('button', { name: 'Zurück' }).click()
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.locator('table tbody tr').first().click()
  await page.getByRole('button', { name: 'Vertrag', exact: true }).click()
  await page.waitForURL(/contract\/print/)
  await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })

  const sheet = page.locator('.paged-source')
  const language = page.getByRole('combobox', { name: 'Sprache des Dokuments' })
  await language.click()
  await page.getByRole('option', { name: 'Englisch (EN)' }).click()
  await expect(sheet).toContainText('GUEST APPEARANCE CONTRACT')
  await expect(sheet).toContainText('Contracting Party 2 (CP2)')
  await expect(sheet).not.toContainText('KONZERTVERTRAG')
  await expect(page.getByRole('button', { name: 'Per E-Mail senden' })).toBeVisible()
  expect(await page.title()).toMatch(/^Guest appearance contract_/)

  const file = await saveTo('Guest_appearance_contract.pdf')
  await page.getByRole('button', { name: 'Als PDF speichern' }).click()
  await expect(page.locator('[data-sonner-toast]', { hasText: 'gespeichert' }).last()).toBeVisible()
  const text = pdfText(file)
  expect(text).toContain('GUEST APPEARANCE CONTRACT')
  expect(text).not.toContain('KONZERTVERTRAG')

  await language.click()
  await page.getByRole('option', { name: 'Deutsch (DE)' }).click()
  await expect(sheet).toContainText('KONZERTVERTRAG')
  expect(await page.title()).toMatch(/^Auftrittsvertrag_/)
})
