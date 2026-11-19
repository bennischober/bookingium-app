// E2E: entity pickers are searchable – type to filter, Enter picks, the
// choice is saved.
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

test('picks a technical lead by searching', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page
    .locator('tr', { hasText: 'The Electric Waves' })
    .getByRole('button', { name: 'Bearbeiten' })
    .click()

  const lead = page.getByRole('combobox', { name: 'Technischer Leiter (TL)' })
  await lead.click()
  await page.keyboard.type('drum')
  await expect(page.getByRole('option')).toHaveText(['Sarah Drummer'])
  await page.keyboard.press('Enter')
  await expect(lead).toHaveText('Sarah Drummer')

  // Nothing matches
  await page.getByRole('combobox', { name: 'Management (vertreten durch)' }).click()
  await page.keyboard.type('gibt es nicht')
  await expect(page.getByText('Keine Firma gefunden.')).toBeVisible()
  // ...but a new one can be created from here
  await expect(
    page.getByRole('option', { name: 'Neue Firma anlegen: „gibt es nicht“' })
  ).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(page.getByText('Band aktualisiert')).toBeVisible()
  await page.locator('tr', { hasText: 'The Electric Waves' }).click()
  await expect(page.getByRole('link', { name: 'Sarah Drummer' }).first()).toBeVisible()
})
