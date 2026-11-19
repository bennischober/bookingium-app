// E2E #199: "Duplizieren" on an event opens the wizard with its band and deal; with a new date
// the new event opens, as "Ausstehend", with the same band.
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

const SOURCE = 'The Electric Waves - Berlin Tour'

test('duplicates an event as a new date with the same band and deal', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.locator('tr', { hasText: SOURCE }).first().click()
  await expect(page.getByRole('heading', { name: SOURCE })).toBeVisible()

  // Duplizieren sits in the header's "…" menu
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Duplizieren…' }).click()
  const wizard = page.getByRole('dialog', { name: 'Event duplizieren' })
  await expect(wizard).toBeVisible()
  await expect(wizard.getByLabel('Eventname')).toHaveValue(SOURCE)
  // the band comes along, the date is asked for again
  await expect(wizard.getByRole('combobox').filter({ hasText: 'The Electric Waves' })).toBeVisible()
  await expect(wizard.getByLabel('Datum')).toHaveValue('')

  await wizard.getByLabel('Eventname').fill(`${SOURCE} (Zusatzshow)`)
  await wizard.getByLabel('Datum').fill('2027-03-20')
  await wizard.getByRole('button', { name: 'Weiter' }).click()
  await wizard.getByRole('button', { name: 'Weiter' }).click()
  await wizard.getByRole('button', { name: 'Event anlegen' }).click()

  // the new event opens: same band, not confirmed yet
  await expect(page.getByRole('heading', { name: `${SOURCE} (Zusatzshow)` })).toBeVisible({
    timeout: 15_000
  })
  await expect(page.getByText('Ausstehend').first()).toBeVisible()
  await expect(page.getByText('The Electric Waves').first()).toBeVisible()

  // the list now has both
  await page.getByRole('link', { name: 'Events' }).first().click()
  await expect(page.locator('tr', { hasText: `${SOURCE} (Zusatzshow)` })).toBeVisible()
  await expect(page.locator('tr', { hasText: SOURCE })).toHaveCount(2)
})

test('the event list duplicates from its row actions', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page
    .locator('tr', { hasText: 'Midnight Symphony' })
    .first()
    .getByRole('button', { name: 'Duplizieren' })
    .click()
  const wizard = page.getByRole('dialog', { name: 'Event duplizieren' })
  await expect(wizard).toBeVisible()
  await expect(wizard.getByRole('combobox').filter({ hasText: 'Midnight Symphony' })).toBeVisible()
  await wizard.getByRole('button', { name: 'Dialog schließen' }).click()
  await expect(wizard).toBeHidden()
})
