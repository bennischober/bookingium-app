// E2E: the calendar switches in Einstellungen › Kalender turn off again. electron-trpc 0.7.1 took
// a falsy input (false, 0, '', null) for no input at all, so turning a switch off failed with
// "erwartet boolean, erhalten undefined"; patches/electron-trpc@0.7.1.patch fixes that.
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

test('calendar switches turn on and off again', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Kalender' }).click()
  for (const name of ['Offene Wiedervorlagen mit aufnehmen', 'Eigene Termine mit aufnehmen']) {
    const toggle = page.getByRole('switch', { name })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  }
  await expect(page.getByText('Einstellung konnte nicht gespeichert werden')).toHaveCount(0)
})
