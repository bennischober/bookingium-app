// E2E: Einstellungen – own company, default country, invoice numbering,
// import entry point and a backup into a chosen folder.
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let backupTarget: string

test.beforeAll(async () => {
  backupTarget = mkdtempSync(join(tmpdir(), 'bookingum-backup-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(backupTarget, { recursive: true, force: true })
})

test('settings page saves defaults and creates a backup', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible()

  // Own company: seeded default, switchable
  const ownCompany = page.getByRole('combobox', { name: 'Eigene Firma' })
  await expect(ownCompany).toHaveText('Live Music Berlin GmbH')
  await ownCompany.click()
  await page.getByRole('option', { name: 'Soundwave Records' }).click()
  await expect(page.getByText('Eigene Firma gespeichert')).toBeVisible()
  await expect(ownCompany).toHaveText('Soundwave Records')

  const country = page.getByRole('combobox', { name: 'Standardland' })
  await expect(country).toHaveText('Deutschland')
  await country.click()
  await page.getByRole('option', { name: 'Österreich' }).click()
  await expect(page.getByText('Einstellung gespeichert')).toBeVisible()

  // Invoice numbering per company
  await page.getByRole('tab', { name: 'Rechnungen' }).click()
  await expect(page.getByRole('combobox', { name: 'Firma', exact: true })).toBeVisible()
  await expect(page.getByLabel('Nächste Rechnungsnummer')).toBeVisible()

  // Import opens the import dialog
  await page.getByRole('tab', { name: 'Daten' }).click()
  await page.getByRole('button', { name: 'Daten importieren…' }).click()
  const importDialog = page.getByRole('dialog', { name: 'Daten importieren' })
  await expect(importDialog).toBeVisible()
  await importDialog.getByRole('button', { name: 'Close' }).click()

  // Backup into the chosen folder
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, backupTarget)
  await page.getByRole('button', { name: 'Sicherung erstellen…' }).click()
  await expect(page.getByText('Sicherung erstellt')).toBeVisible()
  const [folder] = readdirSync(backupTarget)
  expect(folder).toMatch(/^Bookingium-Sicherung \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/)
  expect(existsSync(join(backupTarget, folder, 'bookingum.db'))).toBe(true)
  expect(existsSync(join(backupTarget, folder, 'LIESMICH.txt'))).toBe(true)

  // Settings survive a reload; the tab is kept in the URL
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Daten' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Allgemein' }).click()
  await expect(page.getByRole('combobox', { name: 'Standardland' })).toHaveText('Österreich')
  await expect(page.getByRole('combobox', { name: 'Eigene Firma' })).toHaveText('Soundwave Records')
})

test('the search palette opens a settings tab', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Seiten, Einträge oder Aktionen suchen...').fill('Vorlagen')
  await page.getByRole('option', { name: /E-Mail-Vorlagen und Mailprogramm/ }).click()
  await expect(page.getByRole('tab', { name: 'E-Mail' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#settings-email-subject-de')).toBeVisible()

  // The sidebar link always opens the first tab
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await expect(page.getByRole('tab', { name: 'Allgemein' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

test('the colour scheme is set in settings, the logo leads home', async () => {
  const { page } = h
  const html = page.locator('html')
  await page.getByRole('radio', { name: 'Dunkel' }).click()
  await expect(html).toHaveClass(/\bdark\b/)
  await page.reload()
  await expect(html).toHaveClass(/\bdark\b/)
  await expect(page.getByRole('radio', { name: 'Dunkel' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: 'Hell' }).click()
  await expect(html).not.toHaveClass(/\bdark\b/)

  await page.getByRole('link', { name: 'Bookingium' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})

test('an error nothing caught lands in the local error log, scrubbed', async () => {
  const { page } = h
  const userData = await h.app.evaluate(({ app }) => app.getPath('userData'))
  const logFile = join(userData, 'logs', 'errors.log')
  const probes = (): { source: string; message: string; stack?: string }[] =>
    existsSync(logFile)
      ? readFileSync(logFile, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
          .filter((entry) => String(entry.message).includes('e2e probe'))
      : []

  // A throw in a timer and a promise nobody awaits: both reach the window, then main
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e probe thrown for someone@example.test')
    })
    void Promise.reject(new Error('e2e probe rejected'))
  })
  await expect.poll(() => probes().length).toBe(2)
  const [thrown, rejected] = probes()
  expect(thrown.source).toBe('renderer')
  expect(thrown.message).toBe('Error: e2e probe thrown for <email>')
  expect(JSON.stringify(probes())).not.toContain('someone@example.test')
  expect(rejected.message).toBe('Error: e2e probe rejected')

  // Einstellungen › Daten opens the folder
  await h.app.evaluate(({ shell }) => {
    shell.openPath = (async (target: string) => {
      ;(globalThis as { openedPath?: string }).openedPath = target
      return ''
    }) as never
  })
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Daten' }).click()
  await page.getByRole('button', { name: 'Fehlerprotokoll öffnen' }).click()
  await expect
    .poll(() => h.app.evaluate(() => (globalThis as { openedPath?: string }).openedPath))
    .toBe(join(userData, 'logs'))
})
