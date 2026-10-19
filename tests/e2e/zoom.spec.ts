// Visual check at Windows-150%-scaling-equivalent: deviceScaleFactor 1.5 on a
// 1366x768-class viewport (typical laptop). Screenshots land in
// __screenshots__/zoom150-*.png for manual and automated inspection.
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright-core'
import { resolve } from 'path'
import { createTestUserData } from './helpers/launch'

async function launchAtZoom() {
  const userData = createTestUserData()
  const app = await electron.launch({
    args: [resolve(process.cwd(), 'out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      BOOKINGIUM_USER_DATA: userData.dir
    },
    // Chromium deviceScaleFactor equivalent of Windows 150% display scaling
    deviceScaleFactor: 1.5,
    viewport: { width: 1280, height: 720 }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, cleanup: userData.cleanup }
}

test('dashboard and events table stay usable at 150% zoom', async () => {
  const { app, page, cleanup } = await launchAtZoom()

  try {
    // Dashboard
    await page.waitForSelector('text=Dashboard', { timeout: 15_000 })
    await page.screenshot({ path: 'tests/e2e/__screenshots__/zoom150-dashboard.png' })

    // Events list with data table
    await page.click('text=Events')
    await page.waitForSelector('table', { timeout: 10_000 })
    await page.screenshot({ path: 'tests/e2e/__screenshots__/zoom150-events.png' })

    // Table must not be clipped: its frame scrolls (both ways)
    const scrollable = await page.getByTestId('list-scroll').evaluate((el) => {
      const style = getComputedStyle(el)
      return style.overflowX === 'auto' && style.overflowY === 'auto' && el.scrollWidth > 0
    })
    expect(scrollable).toBe(true)
  } finally {
    await app.close()
    cleanup()
  }
})

test('band members sheet loads and shows members', async () => {
  // Regression: the sheet used to hang on 'Mitglieder werden geladen...'
  // forever because the combined isLoading included the two disabled
  // (non-active entity type) queries, which TanStack Query v4 reports as
  // isLoading=true.
  const { app: zoomApp, page, cleanup } = await launchAtZoom()
  try {
    await page.waitForSelector('text=Dashboard', { timeout: 15_000 })
    await page.goto(`${page.url().split('#')[0]}#/band`)
    await page.waitForSelector('table', { timeout: 10_000 })
    await page
      .locator('table tbody tr', { hasText: 'The Electric Waves' })
      .locator('button[title="Mitglieder"]')
      .click()

    // Members must appear (not stuck on the loading text)
    await page.waitForSelector('text=John Rockstar', { timeout: 10_000 })
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('Mitglieder werden geladen...')
    expect(body).toContain('Lead Vocalist')
  } finally {
    await zoomApp.close()
    cleanup()
  }
})
