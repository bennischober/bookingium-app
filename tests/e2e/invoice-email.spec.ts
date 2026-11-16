// E2E: "Per E-Mail senden" without a mail account (#136). Invoices and contracts are only
// sent from bookingum's own compose window, so a fresh data folder says what is missing and
// leads to Einstellungen › E-Mail; the fixed texts there can be edited and reset. Sending
// itself, with an account, is in mail-client.spec.ts (C1, needs the mail sandbox).
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle

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

/** The newest toast, in front of any still up from an earlier step */
const latestToast = () => h.page.locator('[data-sonner-toast][data-front="true"]')

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
})

test('without a mail account, an invoice says so and leads to the settings', async () => {
  const { page } = h
  await openPrintPage('#1040')
  await page.getByRole('button', { name: 'Per E-Mail senden' }).click()
  const toast = latestToast()
  await expect(toast).toContainText('E-Mail konnte nicht erstellt werden', { timeout: 30_000 })
  await expect(toast).toContainText('Zum Senden zuerst ein E-Mail-Konto hinzufügen.')
  await toast.getByRole('button', { name: 'Einstellungen öffnen' }).click()
  await page.waitForURL(/settings\?tab=email/)
  await expect(page.locator('#settings-invoice-mail-account')).toBeDisabled()

  // Nothing went out, so the invoice is not marked
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  const row = page
    .locator('tr')
    .filter({ has: page.getByRole('cell', { name: '#1040', exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByRole('img', { name: /^E-Mail erstellt am/ })).toHaveCount(0)
})

test('the fixed texts are edited and reset in the E-Mail-Vorlagen card', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'E-Mail' }).click()
  await expect(page.getByRole('heading', { name: 'Für Rechnungen und Verträge' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Eigene Vorlagen' })).toBeVisible()

  const subject = page.locator('#settings-email-subject-de')
  const fields = subject.locator('xpath=ancestor::div[contains(@class,"space-y-3")][1]')
  const standard = await subject.inputValue()
  await subject.fill('Abrechnung {Rechnungsnummer} von {Absender}')
  await fields.getByRole('button', { name: 'Speichern' }).click()
  await expect(latestToast()).toContainText('Vorlage gespeichert')
  await expect(fields.getByRole('button', { name: 'Zurücksetzen' })).toBeEnabled()

  // Stored: still there after a reload
  await page.reload()
  await page.getByRole('tab', { name: 'E-Mail' }).click()
  await expect(subject).toHaveValue('Abrechnung {Rechnungsnummer} von {Absender}')

  await fields.getByRole('button', { name: 'Zurücksetzen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Zurücksetzen' }).click()
  await expect(latestToast()).toContainText('Standardtext wiederhergestellt')
  await expect(subject).toHaveValue(standard)
  await expect(fields.getByRole('button', { name: 'Zurücksetzen' })).toBeDisabled()
})

test('without a mail account, a concert contract says so as well (#120)', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.locator('table tbody tr').first().click()
  await page.getByRole('button', { name: 'Vertrag', exact: true }).click()
  await page.waitForURL(/contract\/print/)
  await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })

  await page.getByRole('button', { name: 'Per E-Mail senden' }).click()
  const toast = latestToast()
  await expect(toast).toContainText('E-Mail konnte nicht erstellt werden', { timeout: 30_000 })
  await expect(toast.getByRole('button', { name: 'Einstellungen öffnen' })).toBeVisible()
})

test('"An DATEV übergeben" asks for the DATEV address first, then for a mail account', async () => {
  const { page } = h
  // The test before ends on a print page, which has no menu
  await page.evaluate(() => (location.hash = '#/'))
  await openPrintPage('#1040')
  await page.getByRole('button', { name: 'An DATEV übergeben' }).click()
  let toast = latestToast()
  await expect(toast).toContainText('Übergabe an DATEV fehlgeschlagen', { timeout: 30_000 })
  await expect(toast).toContainText('keine DATEV-Adresse hinterlegt')
  await toast.getByRole('button', { name: 'Einstellungen öffnen' }).click()
  await page.waitForURL(/settings\?tab=invoices/)

  // The address is kept per issuing company; a typo is refused
  const address = page.getByLabel('Upload-Mail-Adresse')
  const card = address.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  await expect(address).toBeEnabled()
  await address.fill('kein-mailformat')
  await card.getByRole('button', { name: 'Speichern' }).click()
  await expect(latestToast()).toContainText('DATEV-Adresse konnte nicht gespeichert werden')
  await address.fill('upload@duo.example.test')
  await card.getByRole('button', { name: 'Speichern' }).click()
  await expect(latestToast()).toContainText('DATEV-Adresse gespeichert')
  await page.reload()
  await expect(page.getByLabel('Upload-Mail-Adresse')).toHaveValue('upload@duo.example.test')

  // With the address, the missing sending account is what stops it - nothing is recorded
  await openPrintPage('#1040')
  await page.getByRole('button', { name: 'An DATEV übergeben' }).click()
  toast = latestToast()
  await expect(toast).toContainText('Übergabe an DATEV fehlgeschlagen', { timeout: 30_000 })
  await expect(toast).toContainText('Zum Senden zuerst ein E-Mail-Konto hinzufügen.')
  await toast.getByRole('button', { name: 'Einstellungen öffnen' }).click()
  await page.waitForURL(/settings\?tab=email/)
})
