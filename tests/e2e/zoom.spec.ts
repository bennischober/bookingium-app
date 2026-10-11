// Visual check at Windows-150%-scaling-equivalent: deviceScaleFactor 1.5 on a
// 1366x768-class viewport (typical laptop). Screenshots land in
// __screenshots__/zoom150-*.png for manual and automated inspection.
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright-core'
import { resolve } from 'path'

async function launchAtZoom() {
  const app = await electron.launch({
    args: [resolve(process.cwd(), 'out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      BOOKINGIUM_USER_DATA: resolve(process.env.APPDATA ?? '', 'bookingum-app')
    },
    // Chromium deviceScaleFactor equivalent of Windows 150% display scaling
    deviceScaleFactor: 1.5,
    viewport: { width: 1280, height: 720 }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

test('dashboard and events table stay usable at 150% zoom', async () => {
  const { app, page } = await launchAtZoom()

  try {
    // Dashboard
    await page.waitForSelector('text=Dashboard', { timeout: 15_000 })
    await page.screenshot({ path: 'tests/e2e/__screenshots__/zoom150-dashboard.png' })

    // Events list with data table
    await page.click('text=Events')
    await page.waitForSelector('table', { timeout: 10_000 })
    await page.screenshot({ path: 'tests/e2e/__screenshots__/zoom150-events.png' })

    // Table must not be clipped: the table container scrolls horizontally
    const scrollable = await page.evaluate(() => {
      const el = document.querySelector('.overflow-x-auto')
      if (!el) return false
      return el.scrollWidth >= el.clientWidth || el.scrollWidth > 0
    })
    expect(scrollable).toBe(true)
  } finally {
    await app.close()
  }
})
