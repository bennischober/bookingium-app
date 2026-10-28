// E2E: the company page (tabs: overview, contacts, bands, venues, events,
// invoices, documents) and the ways to open it (list row, search palette,
// band page, event page).
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

// Seed: owns both demo bands, LoPro and invoice company of the LA Showcase,
// recipient of invoice #1040 and issuer of a draft to Midnight Symphony
const COMPANY = 'Soundwave Records'

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-docs-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('company page shows contacts, bands, events, invoices and documents', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Firmen' }).first().click()

  // The pencil keeps the quick-edit sheet
  await page
    .locator('tr', { hasText: COMPANY })
    .first()
    .getByRole('button', { name: 'Bearbeiten' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Firma bearbeiten' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  // A row click opens the page
  await page.locator('tr', { hasText: COMPANY }).first().click()
  await expect(page.getByRole('heading', { name: COMPANY })).toBeVisible()
  const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' })
  await expect(breadcrumb).toContainText('Firmen')
  await expect(breadcrumb).toContainText(COMPANY)
  await expect(page.getByText('Bankverbindung')).toBeVisible()
  await expect(page.getByText('Bank of America')).toBeVisible()

  await page.getByRole('tab', { name: 'Ansprechpartner' }).click()
  await expect(page).toHaveURL(/tab=contacts/)
  await expect(page.getByRole('button', { name: 'Person hinzufügen' })).toBeVisible()
  await expect(page.getByText('Tom Manager')).toBeVisible()

  await page.getByRole('tab', { name: 'Bands' }).click()
  const bands = page.getByRole('table', { name: 'Bands der Firma' })
  await expect(bands).toContainText('The Electric Waves')
  await expect(bands).toContainText('Midnight Symphony')
  await expect(bands).toContainText('Firma der Band')

  await page.getByRole('tab', { name: 'Spielstätten' }).click()
  await expect(page.getByText('Keine Spielstätten mit dieser Firma.')).toBeVisible()

  await page.getByRole('tab', { name: 'Events' }).click()
  const events = page.getByRole('table', { name: 'Events der Firma' })
  await expect(events).toContainText('Midnight Symphony - LA Showcase')
  await expect(events).toContainText('LoPro · Rechnungsfirma')

  await page.getByRole('tab', { name: 'Rechnungen' }).click()
  const invoices = page.getByRole('table', { name: 'Rechnungen der Firma' })
  await expect(invoices.getByRole('columnheader', { name: 'Rechnungssteller' })).toBeVisible()
  await expect(invoices.locator('tr', { hasText: '#1040' })).toContainText('Live Music Berlin GmbH')
  await expect(invoices.locator('tr', { hasText: 'Midnight Symphony' })).toContainText('Entwurf')
  // An invoice opens its page; back returns to the tab
  await invoices.locator('tr', { hasText: '#1040' }).click()
  await expect(page.getByRole('heading', { name: 'Rechnung #1040' })).toBeVisible()
  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Rechnungen der Firma' })).toBeVisible()

  // Company document: copied into documents/companies/<id>-soundwave-records/
  await page.getByRole('tab', { name: 'Dokumente' }).click()
  const file = join(fixtureDir, 'Handelsregister.pdf')
  writeFileSync(file, 'register')
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
  await page.getByRole('button', { name: 'Dateien auswählen' }).click()
  await expect(page.getByRole('list', { name: 'Dokumente der Firma' })).toContainText(
    'Handelsregister.pdf'
  )
  const storage = join(
    await h.app.evaluate(({ app }) => app.getPath('userData')),
    'storage',
    'documents',
    'companies'
  )
  const folder = readdirSync(storage).find((name) => name.endsWith('-soundwave-records'))
  expect(folder).toBeTruthy()
  expect(existsSync(join(storage, folder!, 'Handelsregister.pdf'))).toBe(true)

  // A band row opens the band page, whose company link leads back here
  await page.getByRole('tab', { name: 'Bands' }).click()
  await page.getByRole('table', { name: 'Bands der Firma' }).getByText('The Electric Waves').click()
  await expect(page.getByRole('heading', { name: 'The Electric Waves' })).toBeVisible()
  await page.getByRole('link', { name: COMPANY }).click()
  await expect(page.getByRole('heading', { name: COMPANY })).toBeVisible()
})

test('search palette and event page open the company page', async () => {
  const { page } = h
  await page.getByRole('button', { name: 'Alles suchen (Ctrl+K)' }).click()
  await page.getByPlaceholder('Seiten, Einträge oder Aktionen suchen…').fill('Live Music')
  await page.getByRole('option', { name: /Live Music Berlin GmbH/ }).click()
  await expect(page.getByRole('heading', { name: 'Live Music Berlin GmbH' })).toBeVisible()

  // The Berlin event names Live Music Berlin as LoPro company
  await page.getByRole('tab', { name: 'Events' }).click()
  await page
    .getByRole('table', { name: 'Events der Firma' })
    .getByText('The Electric Waves - Berlin Tour')
    .click()
  await expect(
    page.getByRole('heading', { name: 'The Electric Waves - Berlin Tour' })
  ).toBeVisible()
  await page.locator('a[href*="/companies/"]', { hasText: 'Ansehen' }).click()
  await expect(page.getByRole('heading', { name: 'Live Music Berlin GmbH' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(
    'Live Music Berlin GmbH'
  )
})
