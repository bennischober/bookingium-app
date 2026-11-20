// E2E #254: switching the UI to English in Einstellungen › Darstellung reloads the window in
// English, the choice survives a restart (it is a file in the data folder), and switching back
// shows German again.
import { test, expect } from '@playwright/test'
import { createTestUserData, launchApp } from './helpers/launch'

test('switches the UI language and keeps it across a restart', async () => {
  const userData = createTestUserData()
  try {
    let h = await launchApp({ userData: userData.dir })
    const nav = (): ReturnType<typeof h.page.getByRole> =>
      h.page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/ })

    await expect(nav().getByRole('link', { name: 'Kalender' })).toBeVisible({ timeout: 15_000 })
    await nav().getByRole('link', { name: 'Einstellungen' }).click()
    await h.page.getByRole('radio', { name: 'English' }).click()

    // The window reloads in English
    await expect(nav().getByRole('link', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 })
    await expect(nav().getByRole('link', { name: 'Settings' })).toBeVisible()
    await expect(h.page.locator('html')).toHaveAttribute('lang', 'en')
    await h.page.screenshot({ path: 'test-results/ui-language-en.png' })

    // The main pages speak English (one text each, from the page itself, not only the menu)
    const pages: Array<[link: string, text: string, shot: string]> = [
      ['Dashboard', 'Latest invoices', 'dashboard'],
      ['Events', 'Manage shows, tours and deal memos.', 'events'],
      ['Invoices', 'Filter invoices…', 'invoices'],
      ['Bands', 'Manage bands and contacts.', 'bands'],
      ['Companies', "Manage your business partners' companies.", 'companies']
    ]
    for (const [link, text, shot] of pages) {
      await nav().getByRole('link', { name: link, exact: true }).click()
      await expect(
        h.page.getByText(text, { exact: true }).or(h.page.getByPlaceholder(text)).first()
      ).toBeVisible({ timeout: 15_000 })
      await h.page.screenshot({ path: `test-results/ui-language-en-${shot}.png` })
    }
    // An event's detail page with its status tiles
    await nav().getByRole('link', { name: 'Events', exact: true }).click()
    await h.page.locator('tbody tr').first().click()
    await expect(h.page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 15_000 })
    await h.page.screenshot({ path: 'test-results/ui-language-en-event.png' })

    // Still English after a restart on the same data folder
    await h.close()
    h = await launchApp({ userData: userData.dir })
    await expect(nav().getByRole('link', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 })

    // And back to German
    await nav().getByRole('link', { name: 'Settings' }).click()
    await h.page.getByRole('radio', { name: 'Deutsch' }).click()
    await expect(nav().getByRole('link', { name: 'Kalender' })).toBeVisible({ timeout: 15_000 })
    await h.close()
  } finally {
    userData.cleanup()
  }
})
