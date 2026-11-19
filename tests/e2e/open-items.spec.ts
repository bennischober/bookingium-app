// E2E #201: a contract sent but not back is an open point on the event page and the dashboard,
// and leaves both once it is back signed.
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
const OPEN = 'Vertrag am 02.11.2026 verschickt, noch nicht unterschrieben zurück'

async function editFinancials(fill: (page: AppHandle['page']) => Promise<void>) {
  const { page } = h
  await page.getByRole('tab', { name: 'Geld' }).click()
  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  await fill(page)
  await page.getByRole('button', { name: 'Alles speichern' }).click()
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toBeVisible()
}

test('a contract sent but not back is open until it is back signed', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.locator('tr', { hasText: EVENT }).first().click()
  await expect(page.getByRole('heading', { name: EVENT })).toBeVisible()

  await editFinancials((p) => p.getByLabel('Vertrag verschickt am').fill('2026-11-02'))
  const eventItems = page.getByRole('region', { name: 'Offene Punkte des Events' })
  await expect(eventItems.getByRole('link', { name: OPEN })).toBeVisible()

  // The dashboard names the event and links back to its Finanzen tab
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  const dashboardItem = page
    .getByRole('list', { name: 'Offene Punkte' })
    .getByRole('link')
    .filter({ hasText: OPEN })
  await expect(dashboardItem).toContainText(EVENT)
  await dashboardItem.click()
  await expect(page.getByRole('heading', { name: EVENT })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Geld' })).toHaveAttribute('aria-selected', 'true')

  await editFinancials((p) => p.getByLabel('Unterschrieben zurück am').fill('2026-11-10'))
  await expect(eventItems.getByRole('link', { name: OPEN })).toHaveCount(0)
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  // Loaded once the card shows its list or its empty text
  await expect(
    page.getByRole('list', { name: 'Offene Punkte' }).or(page.getByText('Nichts offen'))
  ).toBeVisible()
  await expect(page.getByRole('link').filter({ hasText: OPEN })).toHaveCount(0)
})
