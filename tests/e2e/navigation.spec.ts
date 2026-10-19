// E2E: back/forward in the top bar across pages and records, the Alt+←/→
// shortcuts and the history list on right-click.
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

const EVENT = 'The Electric Waves - Berlin Tour'

test('goes back and forward across pages and records', async () => {
  const { page } = h
  const back = page.getByRole('button', { name: 'Zurück', exact: true })
  const forward = page.getByRole('button', { name: 'Vorwärts', exact: true })
  const crumbs = page.getByRole('navigation', { name: 'breadcrumb' })

  // Nothing to go back to on start; Alt+← must not leave the app
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(crumbs).toContainText('Dashboard')

  // Dashboard → Events → event → Bands (Alt+digit jump)
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.locator('tr', { hasText: EVENT }).first().click()
  await expect(crumbs).toContainText(EVENT)
  // Switching tabs does not add history entries
  await page.getByRole('tab', { name: 'Finanzen' }).click()
  await page.getByRole('tab', { name: 'Übersicht' }).click()
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await expect(crumbs).toContainText('Bands')

  await back.click()
  await expect(crumbs).toContainText(EVENT)
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(crumbs).toContainText('Events')
  await expect(crumbs).not.toContainText(EVENT)

  await forward.click()
  await expect(crumbs).toContainText(EVENT)
  await page.keyboard.press('Alt+ArrowRight')
  await expect(crumbs).toContainText('Bands')
  await expect(forward).toBeDisabled()

  // Right-click lists the visited pages by name, most recent first
  await back.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Verlauf zurück' })
  await expect(menu.getByRole('menuitem')).toHaveText([`Events › ${EVENT}`, 'Events', 'Dashboard'])
  await menu.getByRole('menuitem', { name: 'Dashboard' }).click()
  await expect(crumbs).toContainText('Dashboard')
  await expect(back).toBeDisabled()

  // A new page drops the pages ahead
  await expect(forward).toBeEnabled()
  await page.getByRole('link', { name: 'Rechnungen' }).first().click()
  await expect(forward).toBeDisabled()
})
