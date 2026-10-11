// Launches the built Electron app for e2e tests.
// Requires a prior build (pnpm build) - tests run against out/main/index.js,
// the same code path as the packaged app.
import { _electron as electron } from 'playwright-core'
import type { Page, ElectronApplication } from 'playwright-core'
import { resolve } from 'path'

export type AppHandle = {
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
  /** printToPDF on the main window's webContents */
  printPageToPdf: () => Promise<Buffer>
}

export async function launchApp(): Promise<AppHandle> {
  const app = await electron.launch({
    // Resolve from the project root (process.cwd()), not __dirname - the
    // playwright transpilation output lives elsewhere.
    args: [resolve(process.cwd(), 'out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })

  app.on('window', (page) => {
    void page
  })
  app.process().stdout?.on('data', (d) => console.log('[app]', String(d).trim()))
  app.process().stderr?.on('data', (d) => console.error('[app:err]', String(d).trim()))

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return {
    app,
    page,
    close: async () => {
      await app.close()
    },
    printPageToPdf: () =>
      app.evaluate(
        async ({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (!win) throw new Error('no window')
          return win.webContents.printToPDF({
            landscape: false,
            printBackground: true,
            pageSize: 'A4',
            margins: { top: 0, bottom: 0, left: 0, right: 0 }
          })
        }
      )
  }
}
