// E2E: back/forward in the top bar across pages and records, the Alt+←/→
// shortcuts, the history list on right-click and the "new" shortcut.
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

test('Alt + „+“ / Ctrl+N creates what the list shows, elsewhere offers the + Neu menu', async () => {
  const { page } = h
  const crumbs = page.getByRole('navigation', { name: 'breadcrumb' })

  // Dashboard: the menu to pick from
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await expect(crumbs).toContainText('Dashboard')
  await page.keyboard.press('Alt++')
  const menu = page.getByRole('menu', { name: 'Neu anlegen' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // Bands: a new band
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await expect(crumbs).toContainText('Bands')
  await page.keyboard.press('Control+n')
  const sheet = page.getByRole('dialog', { name: 'Neue Band anlegen' })
  await expect(sheet).toBeVisible()
  // Not again over the open sheet
  await page.keyboard.press('Alt++')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  // Events: the new-event wizard
  await page.getByRole('link', { name: 'Events' }).first().click()
  await expect(crumbs).toContainText('Events')
  await page.keyboard.press('Alt++')
  await expect(page.getByRole('dialog', { name: 'Neues Event anlegen' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('a detail route with a bad id shows "nicht gefunden" instead of loading forever', async () => {
  const { page } = h
  for (const [path, text] of [
    ['/band/abc', 'Band nicht gefunden.'],
    ['/companies/abc', 'Firma nicht gefunden.'],
    ['/persons/abc', 'Person nicht gefunden.'],
    ['/venues/abc', 'Spielstätte nicht gefunden.'],
    ['/invoices/abc', 'Rechnung nicht gefunden.'],
    ['/band/99999', 'Band nicht gefunden.']
  ]) {
    await page.evaluate((hash) => (window.location.hash = hash), path)
    await expect(page.getByText(text)).toBeVisible()
  }
})
