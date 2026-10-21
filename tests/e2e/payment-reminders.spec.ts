// E2E: payment reminders. An invoice marked überfällig (seeded #1040) shows
// on the Dashboard with its next step; the Zahlungserinnerung is created on
// the print page from its own template, and after it a Mahnung is offered.
// BOOKINGIUM_NO_LAUNCH (launch.ts) keeps mail programs closed, so the .eml
// in <userData>/E-Mail is all there is.
import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let emailFolder: string

/** Subject of the .eml in the email folder, with its =?UTF-8?B?…?= words decoded */
function emailSubject(): string {
  const name = existsSync(emailFolder)
    ? readdirSync(emailFolder).find((file) => file.endsWith('.eml'))
    : undefined
  if (!name) return ''
  const eml = readFileSync(join(emailFolder, name), 'utf-8')
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

test('sends a Zahlungserinnerung for an overdue invoice, then offers a Mahnung', async () => {
  const { page } = h
  // Nothing overdue yet: no card
  await expect(page.getByText('Unbezahlte Rechnungen')).toBeVisible()
  await expect(page.getByText('Überfällige Rechnungen')).toHaveCount(0)

  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await page
    .locator('tr')
    .filter({ has: page.getByRole('cell', { name: '#1040', exact: true }) })
    .getByRole('button', { name: 'Anzeigen' })
    .click()
  await expect(page.getByRole('heading', { name: 'Rechnung #1040' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zahlungserinnerung senden…' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Als überfällig markieren' }).click()
  await expect(page.getByRole('button', { name: 'Zahlungserinnerung senden…' })).toBeVisible()

  // The Dashboard lists it with its next step
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  const row = page
    .getByRole('region', { name: 'Überfällige Rechnungen' })
    .getByRole('listitem')
    .filter({ hasText: '#1040' })
  await expect(row).toContainText('Als überfällig markiert')
  await row.getByRole('button', { name: 'Zahlungserinnerung senden…' }).click()

  await page.waitForURL(/invoices\/\d+\/print\?email=reminder/)
  await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Per E-Mail senden', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Zahlungserinnerung per E-Mail senden' }).click()
  await expect(page.locator('[data-sonner-toast]', { hasText: 'E-Mail gespeichert' })).toBeVisible({
    timeout: 30_000
  })
  expect(emailSubject()).toMatch(
    /^(Zahlungserinnerung|Payment reminder): (Rechnung|Invoice) 1040\b/
  )

  // Next comes the Mahnung, on the Dashboard and the invoice page
  await page.getByRole('button', { name: 'Zurück' }).click()
  await expect(row).toContainText(/Zahlungserinnerung am \d\d\.\d\d\.\d{4}/)
  await expect(row.getByRole('button', { name: 'Mahnung senden…' })).toBeVisible()
  await row.getByRole('button', { name: 'Rechnung öffnen' }).click()
  await expect(page.getByRole('heading', { name: 'Rechnung #1040' })).toBeVisible()
  const history = page.getByRole('list', { name: 'Verlauf' }).getByRole('listitem')
  await expect(history.last()).toContainText('Zahlungserinnerung erstellt')
  await expect(page.getByRole('button', { name: 'Mahnung senden…' })).toBeVisible()

  // Paid: off the Dashboard
  await page.getByRole('button', { name: 'Als bezahlt markieren' }).click()
  await expect(page.getByRole('button', { name: 'Mahnung senden…' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await expect(page.getByText('Unbezahlte Rechnungen')).toBeVisible()
  await expect(page.getByText('Überfällige Rechnungen')).toHaveCount(0)
})
