// Closes the toasts a spec left behind. The specs in a file share one app,
// and error toasts stay until closed (ERROR_TOAST_DURATION in lib/toast.ts),
// so one can still cover a button the next test clicks (#173).
import { expect } from '@playwright/test'
import type { Page } from 'playwright-core'

/** Click each toast's "Schließen" until none is left */
export async function dismissToasts(page: Page): Promise<void> {
  const close = page
    .getByRole('region', { name: /^Notifications/ })
    .getByRole('button', { name: 'Schließen' })
  await expect(async () => {
    // A stacked toast behind the front one is collapsed: its button is never visible, so a real
    // click waits for it forever (contact-list.spec timed out on it). The click event closes it
    // all the same; a closing toast animates out, so retry until none is left.
    if ((await close.count()) > 0) await close.first().dispatchEvent('click')
    expect(await close.count()).toBe(0)
  }).toPass({ timeout: 10_000 })
}
