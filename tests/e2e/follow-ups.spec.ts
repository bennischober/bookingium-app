// E2E: follow-ups (Wiedervorlagen) – created on a band, shown on its page,
// on the Dashboard and as the sidebar count; done with undo, edited, deleted;
// a general one from the Dashboard; and one offered on saving an invoice draft.
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle

const BAND = 'The Electric Waves'

/** Today as the app sees it (local calendar day) */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
})

test('a follow-up on a band shows on its page and the Dashboard, done and back', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page.locator('tr', { hasText: BAND }).first().click()
  await expect(page.getByRole('heading', { name: BAND })).toBeVisible()
  // Nothing open yet: no strip
  await expect(page.getByRole('region', { name: 'Wiedervorlagen' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Wiedervorlage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Neue Wiedervorlage' })
  await expect(dialog).toContainText(`Zu ${BAND}`)
  // Note required
  await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  await dialog.getByLabel('Fällig am').fill(today())
  await dialog.getByLabel('Notiz').fill('Rider schicken')
  await dialog.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Wiedervorlage angelegt')).toBeVisible()

  const strip = page.getByRole('region', { name: 'Wiedervorlagen' })
  await expect(strip).toContainText('Rider schicken')
  await expect(strip).toContainText('Heute')

  // Due today: counted on the Dashboard menu item
  const badge = page.locator('[data-sidebar="menu-badge"]')
  await expect(badge).toContainText('1')

  // The Dashboard lists it with a link back to the band
  await page.getByRole('link', { name: 'Bookingium' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Rider schicken')).toBeVisible()
  await expect(page.getByRole('link', { name: BAND })).toBeVisible()

  // Done, then undone from the toast
  await page.getByRole('button', { name: 'Erledigt: Rider schicken' }).click()
  await expect(page.getByText('Wiedervorlage erledigt')).toBeVisible()
  // (the toast still shows the note, so look for the row's button)
  const done = page.getByRole('button', { name: 'Erledigt: Rider schicken' })
  await expect(done).toHaveCount(0)
  await expect(badge).toHaveCount(0)
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await expect(done).toBeVisible()
  await expect(badge).toContainText('1')

  // Edit: move it a week out, no longer due
  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  const edit = page.getByRole('dialog', { name: 'Wiedervorlage bearbeiten' })
  await edit.getByRole('button', { name: 'In 1 Woche' }).click()
  await edit.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Wiedervorlage gespeichert')).toBeVisible()
  await expect(badge).toHaveCount(0)

  // Delete, after confirming
  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  await page
    .getByRole('dialog', { name: 'Wiedervorlage bearbeiten' })
    .getByRole('button', { name: 'Löschen' })
    .click()
  await page
    .getByRole('dialog', { name: 'Wiedervorlage löschen?' })
    .getByRole('button', { name: 'Löschen' })
    .click()
  await expect(page.getByText('Wiedervorlage gelöscht')).toBeVisible()
  await expect(page.getByText('Keine offenen Wiedervorlagen.')).toBeVisible()
})

test('a general follow-up from the Dashboard', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Bookingium' }).click()
  await page.getByRole('button', { name: 'Wiedervorlage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Neue Wiedervorlage' })
  await expect(dialog).toContainText('Allgemein, ohne Datensatz')
  await dialog.getByLabel('Notiz').fill('Festivalsaison planen')
  // Ctrl+Enter saves from the note
  await dialog.getByLabel('Notiz').press('Control+Enter')
  await expect(page.getByRole('button', { name: 'Erledigt: Festivalsaison planen' })).toBeVisible()
  await expect(page.getByText(/· Allgemein/)).toBeVisible()
})

test('saving an invoice draft offers a follow-up, shown in the sheet', async () => {
  const { page } = h
  const record = 'Rechnungsentwurf · Midnight Symphony'
  const draftRow = page
    .locator('tr')
    .filter({ has: page.getByRole('cell', { name: 'Entwurf', exact: true }) })
  const saveDraft = async () => {
    await draftRow.getByRole('button', { name: 'Bearbeiten' }).click()
    await page.getByRole('button', { name: 'Weiter: Positionen' }).click()
    await page.getByRole('button', { name: 'Weiter: Abschließen' }).click()
    await page.getByRole('button', { name: 'Entwurf speichern' }).click()
  }
  const toast = page.locator('[data-sonner-toast]', { hasText: 'Entwurf gespeichert' })

  // The last test's toasts first, so the texts below are this test's
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await saveDraft()
  // Offered in the toast, created only on click, with a prefilled note
  await toast.getByRole('button', { name: 'Wiedervorlage setzen' }).click()
  const dialog = page.getByRole('dialog', { name: 'Neue Wiedervorlage' })
  await expect(dialog).toContainText(`Zu ${record}`)
  await expect(dialog.getByLabel('Notiz')).toHaveValue('Entwurf vervollständigen')
  await dialog.getByLabel('Fällig am').fill(today())
  await dialog.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Wiedervorlage angelegt')).toBeVisible()

  // On the Dashboard, linking back to the draft, which opens in its sheet
  await page.getByRole('link', { name: 'Bookingium' }).click()
  await page.getByRole('link', { name: record }).click()
  const sheet = page.getByRole('dialog', { name: 'Entwurf bearbeiten' })
  const strip = sheet.getByRole('region', { name: 'Wiedervorlagen' })
  await expect(strip).toContainText('Entwurf vervollständigen')
  await page.keyboard.press('Escape')

  // Saved again with a follow-up open: no second offer
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  await saveDraft()
  await expect(toast).toBeVisible()
  await expect(toast.getByRole('button', { name: 'Wiedervorlage setzen' })).toHaveCount(0)

  // Done from the sheet
  await draftRow.getByRole('button', { name: 'Bearbeiten' }).click()
  await strip.getByRole('button', { name: 'Erledigt: Entwurf vervollständigen' }).click()
  await expect(strip).toHaveCount(0)
  // The toast's undo works over the open sheet, which stays open
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await expect(strip).toContainText('Entwurf vervollständigen')
})
