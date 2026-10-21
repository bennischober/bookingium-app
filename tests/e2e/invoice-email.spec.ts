// E2E: "Per E-Mail senden" on an issued invoice (seeded #1040) writes the
// PDF and an .eml draft into <userData>/E-Mail, uses the template from the
// settings and marks the invoice. BOOKINGIUM_NO_LAUNCH (launch.ts) keeps
// mail programs and Explorer closed, so the files are all there is.
import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let emailFolder: string

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

/** Subject of an .eml, with its =?UTF-8?B?…?= words decoded */
function subjectOf(eml: string): string {
  const line = /^Subject: (.*(?:\r\n .*)*)/m.exec(eml)?.[1] ?? ''
  return line
    .replace(/\?=\r\n =\?/g, '?==?')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_match, data: string) =>
      Buffer.from(data, 'base64').toString('utf-8')
    )
}

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  const userData = await h.app.evaluate(({ app }) => app.getPath('userData'))
  emailFolder = join(userData, 'E-Mail')
})

test.afterAll(async () => {
  await h.close()
})

test('creates the email with the PDF and marks the invoice', async () => {
  const { page } = h
  await openPrintPage('#1040')
  await page.getByRole('button', { name: 'Per E-Mail senden' }).click()
  const toast = page.locator('[data-sonner-toast]', { hasText: 'E-Mail gespeichert' })
  await expect(toast).toBeVisible({ timeout: 30_000 })
  await expect(toast.getByRole('button', { name: 'Ordner öffnen' })).toBeVisible()

  const files = readdirSync(emailFolder).sort()
  const eml = files.find((name) => name.endsWith('.eml'))!
  const pdf = files.find((name) => name.endsWith('.pdf'))!
  expect(eml).toMatch(/^Rechnung_1040_.*\.eml$/)
  expect(pdf).toBe(eml.replace(/\.eml$/, '.pdf'))
  expect(readFileSync(join(emailFolder, pdf)).subarray(0, 5).toString()).toBe('%PDF-')

  const text = readFileSync(join(emailFolder, eml), 'utf-8')
  expect(text.startsWith('X-Unsent: 1\r\n')).toBe(true)
  expect(subjectOf(text)).toMatch(/^(Rechnung|Invoice) 1040\b/)
  expect(text).toContain('Content-Type: application/pdf')

  // Marked in the invoice list
  await page.getByRole('button', { name: 'Zurück' }).click()
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  const row = page
    .locator('tr')
    .filter({ has: page.getByRole('cell', { name: '#1040', exact: true }) })
  await expect(
    row.getByRole('img', { name: /^E-Mail erstellt am \d\d\.\d\d\.\d{4}/ })
  ).toBeVisible()
})

test('uses the subject from the settings', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'E-Mail' }).click()
  for (const lang of ['de', 'en']) {
    const subject = page.locator(`#settings-email-subject-${lang}`)
    await subject.fill(`Abrechnung {Rechnungsnummer} von {Absender} ({Fällig})`)
    await subject
      .locator('xpath=ancestor::div[contains(@class,"space-y-3")][1]')
      .getByRole('button', { name: 'Speichern' })
      .click()
    await expect(
      page.locator('[data-sonner-toast]', { hasText: 'Einstellung gespeichert' }).first()
    ).toBeVisible()
  }

  await openPrintPage('#1040')
  rmSync(emailFolder, { recursive: true, force: true })
  await page.getByRole('button', { name: 'Per E-Mail senden' }).click()
  const subject = () => {
    const eml = existsSync(emailFolder)
      ? readdirSync(emailFolder).find((name) => name.endsWith('.eml'))
      : undefined
    return eml ? subjectOf(readFileSync(join(emailFolder, eml), 'utf-8')) : ''
  }
  await expect
    .poll(subject, { timeout: 30_000 })
    .toMatch(/^Abrechnung 1040 von .+ \(\d\d\.\d\d\.\d{4}\)$/)
})

test('lists every email in the invoice sheet, latest first', async () => {
  const { page } = h
  await page.getByRole('button', { name: 'Zurück' }).click()
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await page
    .locator('tr')
    .filter({ has: page.getByRole('cell', { name: '#1040', exact: true }) })
    .getByRole('button', { name: 'Anzeigen' })
    .click()
  const emails = page.getByRole('dialog').getByRole('list', { name: 'E-Mails' })
  // One per "Per E-Mail senden" of the tests above
  await expect(emails.getByRole('listitem')).toHaveCount(2)
  await expect(emails.getByRole('listitem').first()).toHaveText(
    /^\d\d\.\d\d\.\d{4}, \d\d:\d\d( an .+@.+)?$/
  )
})
