// Launches the built Electron app for e2e tests.
// Requires a prior build (pnpm build) - tests run against out/main/index.js,
// the same code path as the packaged app.
import { _electron as electron } from 'playwright-core'
import type { Page, ElectronApplication } from 'playwright-core'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * userData folder for one app launch. By default a fresh, empty temp folder:
 * the app migrates and seeds it on start, so tests never touch the real
 * database (%APPDATA%/bookingum-app) and always see the same seed data.
 * Set BOOKINGIUM_E2E_USER_DATA to run against a specific folder instead
 * (e.g. a copy of real data) - it is used as-is and never deleted.
 */
export function createTestUserData(): { dir: string; cleanup: () => void } {
  const explicit = process.env.BOOKINGIUM_E2E_USER_DATA
  if (explicit) return { dir: resolve(explicit), cleanup: () => {} }

  const dir = mkdtempSync(join(tmpdir(), 'bookingum-e2e-'))
  return {
    dir,
    // Best effort: Chromium may still hold files briefly after quitting
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

export type AppHandle = {
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
  /** printToPDF on the main window's webContents */
  printPageToPdf: () => Promise<Buffer>
}

export async function launchApp(): Promise<AppHandle> {
  const userData = createTestUserData()
  const app = await electron.launch({
    // Resolve from the project root (process.cwd()), not __dirname - the
    // playwright transpilation output lives elsewhere.
    args: [resolve(process.cwd(), 'out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      BOOKINGIUM_USER_DATA: userData.dir,
      // Per E-Mail senden: write the files only, never open a mail program
      BOOKINGIUM_NO_LAUNCH: '1'
    }
  })

  app.on('window', (page) => {
    void page
  })
  app.process().stdout?.on('data', (d) => console.log('[app]', String(d).trim()))
  app.process().stderr?.on('data', (d) => console.error('[app:err]', String(d).trim()))

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Identify the BrowserWindow that owns Playwright's page (by URL) at call
  // time - window index [0] is not stable across navigations in tests.
  const printPageToPdf = () =>
    app.evaluate(async ({ BrowserWindow }, targetUrl) => {
      const windows = BrowserWindow.getAllWindows()
      const win = windows.find((w) => w.webContents.getURL().includes(targetUrl)) ?? windows[0]
      if (!win) throw new Error('no window')
      return win.webContents.printToPDF({
        landscape: false,
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      })
    }, 'contract/print')

  return {
    app,
    page,
    close: async () => {
      await app.close()
      userData.cleanup()
    },
    printPageToPdf
  }
}
