// E2E #200: pick several events in the list, set one status for all, undo it, then archive
// them and bring them back from the toast.
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

/** The newest toast, in front of any still up from an earlier step */
const latestToast = () => h.page.locator('[data-sonner-toast]').first()

test('sets the status of several events at once, and archives them, each undoable', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  const count = await rows.count()
  expect(count).toBeGreaterThanOrEqual(2)

  // Picking does not open the event; the toolbar says how many are picked
  await rows.nth(0).getByRole('checkbox', { name: 'Auswählen' }).check()
  await rows.nth(1).getByRole('checkbox', { name: 'Auswählen' }).check()
  await expect(page).toHaveURL(/#\/events$/)
  const bar = page.getByRole('toolbar', { name: 'Auswahl' })
  await expect(bar).toContainText('2 Events ausgewählt')

  // One status for both, after a confirm that names the count
  await bar.getByRole('combobox', { name: 'Status setzen' }).click()
  await page.getByRole('option', { name: 'Storniert' }).click()
  await page.getByRole('button', { name: 'Status setzen' }).click()
  await expect(latestToast()).toContainText('auf „Storniert“ gesetzt')
  await expect(bar).toBeHidden()
  const cancelled = page.locator('tbody tr', { hasText: 'Storniert' })
  const cancelledBefore = await cancelled.count()
  expect(cancelledBefore).toBeGreaterThanOrEqual(2)

  // "Rückgängig" brings the old statuses back
  await latestToast().getByRole('button', { name: 'Rückgängig' }).click()
  await expect.poll(() => cancelled.count()).toBeLessThan(cancelledBefore)

  // The header checkbox picks all loaded rows; archiving them empties the list
  await page.getByRole('checkbox', { name: 'Alle geladenen auswählen' }).check()
  await expect(bar).toContainText(`${count} Events ausgewählt`)
  await bar.getByRole('button', { name: 'Archivieren' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archivieren' }).click()
  await expect(latestToast()).toContainText(`${count} Events archiviert`)
  await expect(page.getByText('Keine Ergebnisse gefunden.')).toBeVisible()

  // ... and "Rückgängig" restores exactly those
  await latestToast().getByRole('button', { name: 'Rückgängig' }).click()
  await expect(rows).toHaveCount(count)
})
