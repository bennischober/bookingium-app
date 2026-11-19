// E2E (#253): a tip on the dashboard is clicked away and stays away; the settings bring all tips
// back or switch them off
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

test('tips are clicked away, brought back and switched off', async () => {
  const { page } = h
  const dashboardTip = page.getByRole('complementary', { name: 'Tipp: Schneller ans Ziel' })
  await expect(dashboardTip).toBeVisible()
  await dashboardTip.getByRole('button', { name: 'Tipp ausblenden' }).click()
  await expect(dashboardTip).toBeHidden()

  // Gone also after leaving the page and coming back
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(dashboardTip).toBeHidden()

  // The settings bring it back
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await expect(page.getByText('1 von 7 Tipps ausgeblendet')).toBeVisible()
  await page.getByRole('button', { name: 'Alle Tipps wieder anzeigen' }).click()
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await expect(dashboardTip).toBeVisible()

  // Switched off: no tip anywhere
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('switch', { name: 'Tipps anzeigen' }).click()
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(dashboardTip).toBeHidden()
  await expect(page.getByRole('complementary', { name: /^Tipp:/ })).toHaveCount(0)
})
