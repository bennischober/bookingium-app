// E2E: payment reminders. An invoice marked überfällig (seeded #1040) shows
// on the Dashboard with its next step and leads to the print page of the
// Zahlungserinnerung. #136: it is sent only from bookingum's compose window, so
// without a mail account it says so and nothing is recorded; once paid, it is
// off the Dashboard.
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
})

test('offers a Zahlungserinnerung for an overdue invoice', async () => {
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
  const toast = page.locator('[data-sonner-toast][data-front="true"]')
  await expect(toast).toContainText('Zum Senden zuerst ein E-Mail-Konto hinzufügen.', {
    timeout: 30_000
  })

  // Not sent: no Mahnung offered yet, nothing in the Verlauf
  await page.getByRole('button', { name: 'Zurück' }).click()
  await expect(row.getByRole('button', { name: 'Zahlungserinnerung senden…' })).toBeVisible()
  await row.getByRole('button', { name: 'Rechnung öffnen' }).click()
  await expect(page.getByRole('heading', { name: 'Rechnung #1040' })).toBeVisible()
  const history = page.getByRole('list', { name: 'Verlauf' }).getByRole('listitem')
  await expect(history.filter({ hasText: 'Zahlungserinnerung erstellt' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Mahnung senden…' })).toHaveCount(0)

  // Paid: off the Dashboard
  await page.getByRole('button', { name: 'Als bezahlt markieren' }).click()
  await expect(page.getByRole('button', { name: 'Zahlungserinnerung senden…' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await expect(page.getByText('Unbezahlte Rechnungen')).toBeVisible()
  await expect(page.getByText('Überfällige Rechnungen')).toHaveCount(0)
})
