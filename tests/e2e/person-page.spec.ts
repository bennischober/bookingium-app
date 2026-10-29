// E2E: the person page (tabs: overview, bands, companies, venues, events,
// contracts, invoices, documents) and the ways to open it (list row, search
// palette, band members, event page).
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

// Seed: works for Soundwave Records and Live Music Berlin, at both venues,
// LoPro contact of the Berlin Tour and recipient of invoice #1041
const PERSON = 'Tom Manager'
// The list shows first and last name in separate cells
const EMAIL = 'tom.manager@soundwave.example.test'

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-docs-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('person page shows memberships, events, invoices and documents', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Personen' }).first().click()

  // The pencil keeps the quick-edit sheet
  await page
    .locator('tr', { hasText: EMAIL })
    .first()
    .getByRole('button', { name: 'Bearbeiten' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Person bearbeiten' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  // A row click opens the page
  await page.locator('tr', { hasText: EMAIL }).first().click()
  await expect(page.getByRole('heading', { name: PERSON })).toBeVisible()
  const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' })
  await expect(breadcrumb).toContainText('Personen')
  await expect(breadcrumb).toContainText(PERSON)
  await expect(page.getByText('10.05.1975')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Soundwave Records' })).toContainText(
    'Tour Manager'
  )

  await page.getByRole('tab', { name: 'Firmen' }).click()
  await expect(page).toHaveURL(/tab=companies/)
  await expect(page.getByRole('link', { name: 'Soundwave Records' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Live Music Berlin GmbH' })).toBeVisible()
  await expect(
    page.getByText('Bei keiner Firma als Ansprechpartner für Rechnungen eingetragen.')
  ).toBeVisible()

  await page.getByRole('tab', { name: 'Clubs / Festivals' }).click()
  await expect(page.getByRole('link', { name: 'Berghain' })).toBeVisible()
  await expect(page.getByText('Stage Manager')).toBeVisible()
  // The tab now has the same second section as Bands and Companies: the events
  // at those venues, so it no longer looks unfinished next to them
  const venueEvents = page.getByRole('table', { name: 'Events in Berghain' })
  await expect(venueEvents).toContainText('The Electric Waves - Berlin Tour')

  await page.getByRole('tab', { name: 'Events' }).click()
  const events = page.getByRole('table', { name: 'Events der Person' })
  await expect(events.locator('tr', { hasText: 'The Electric Waves - Berlin Tour' })).toContainText(
    'LoPro-Kontakt'
  )

  await page.getByRole('tab', { name: 'Managementverträge' }).click()
  await expect(page.getByText('In keinem Managementvertrag aufgeführt.')).toBeVisible()

  await page.getByRole('tab', { name: 'Rechnungen' }).click()
  const invoices = page.getByRole('table', { name: 'Rechnungen an die Person' })
  await expect(invoices.locator('tr', { hasText: '#1041' })).toContainText('Live Music Berlin')
  // An invoice opens its page; back returns to the tab
  await invoices.locator('tr', { hasText: '#1041' }).click()
  await expect(page.getByRole('heading', { name: 'Rechnung #1041' })).toBeVisible()
  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Rechnungen an die Person' })).toBeVisible()

  // Person document: copied into documents/persons/<id>-tom-manager/
  await page.getByRole('tab', { name: 'Dokumente' }).click()
  const file = join(fixtureDir, 'Vertrag.pdf')
  writeFileSync(file, 'contract')
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
  await page.getByRole('button', { name: 'Dateien auswählen' }).click()
  await expect(page.getByRole('table', { name: 'Dokumente der Person' })).toContainText(
    'Vertrag.pdf'
  )
  const storage = join(
    await h.app.evaluate(({ app }) => app.getPath('userData')),
    'storage',
    'documents',
    'persons'
  )
  const folder = readdirSync(storage).find((name) => name.endsWith('-tom-manager'))
  expect(folder).toBeTruthy()
  expect(existsSync(join(storage, folder!, 'Vertrag.pdf'))).toBe(true)

  // Join a band here; its members tab links back to this page
  await page.getByRole('tab', { name: 'Bands' }).click()
  await page.getByRole('button', { name: 'Zur Band hinzufügen' }).click()
  const dialog = page.getByRole('dialog', { name: 'Zur Band hinzufügen' })
  await dialog.getByRole('combobox', { name: 'Band' }).click()
  await page.keyboard.type('Electric')
  await page.keyboard.press('Enter')
  await dialog.getByLabel('Rolle').fill('Tourleitung')
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Tourleitung')).toBeVisible()

  await page.getByRole('link', { name: 'The Electric Waves' }).click()
  await expect(page.getByRole('heading', { name: 'The Electric Waves' })).toBeVisible()
  await page.getByRole('tab', { name: 'Mitglieder' }).click()
  await page.getByRole('link', { name: PERSON }).click()
  await expect(page.getByRole('heading', { name: PERSON })).toBeVisible()
})

test('search palette and event page open the person page', async () => {
  const { page } = h
  await page.getByRole('button', { name: 'Alles suchen (Ctrl+K)' }).click()
  await page.getByPlaceholder('Seiten, Einträge oder Aktionen suchen…').fill('Tom')
  await page
    .getByRole('option', { name: /Tom Manager/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: PERSON })).toBeVisible()

  // The Berlin event names Tom Manager as LoPro contact
  await page.getByRole('tab', { name: 'Events' }).click()
  await page
    .getByRole('table', { name: 'Events der Person' })
    .getByText('The Electric Waves - Berlin Tour')
    .click()
  await expect(
    page.getByRole('heading', { name: 'The Electric Waves - Berlin Tour' })
  ).toBeVisible()
  await page.locator('a[href*="/persons/"]', { hasText: 'Ansehen' }).click()
  await expect(page.getByRole('heading', { name: PERSON })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(PERSON)
})
