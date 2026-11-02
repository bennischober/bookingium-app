// E2E: the venue page (tabs: overview, contacts, events, documents) and the
// ways to open it (list row, search palette, event page).
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

// Seed: run by Live Music Berlin GmbH, venue of the Berlin event
const VENUE = 'Berghain'
const EVENT = 'The Electric Waves - Berlin Tour'

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-docs-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('venue page shows overview, contacts, events and documents', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Clubs' }).first().click()

  // The pencil keeps the quick-edit sheet
  await page
    .locator('tr', { hasText: VENUE })
    .first()
    .getByRole('button', { name: 'Bearbeiten' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Club bearbeiten' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  // A row click opens the page
  await page.locator('tr', { hasText: VENUE }).first().click()
  await expect(page.getByRole('heading', { name: VENUE })).toBeVisible()
  const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' })
  await expect(page).toHaveURL(/#\/clubs\/\d+$/)
  await expect(breadcrumb).toContainText('Clubs')
  await expect(breadcrumb).toContainText(VENUE)
  await expect(page.getByText('Art / Kapazität')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Live Music Berlin GmbH' })).toBeVisible()

  await page.getByRole('tab', { name: 'Ansprechpartner' }).click()
  await expect(page).toHaveURL(/tab=contacts/)
  await expect(page.getByRole('button', { name: 'Person hinzufügen' })).toBeVisible()
  await expect(page.getByText('Tom Manager')).toBeVisible()

  await page.getByRole('tab', { name: 'Events' }).click()
  const events = page.getByRole('table', { name: 'Events des Clubs' })
  await expect(events.locator('tr', { hasText: EVENT })).toContainText('The Electric Waves')

  // Venue document: copied into documents/venues/<id>-berghain/
  await page.getByRole('tab', { name: 'Dokumente' }).click()
  const file = join(fixtureDir, 'Bühnenplan.pdf')
  writeFileSync(file, 'stage')
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
  await page.getByRole('button', { name: 'Dateien auswählen' }).click()
  await expect(page.getByRole('table', { name: 'Dokumente des Clubs' })).toContainText(
    'Bühnenplan.pdf'
  )
  const storage = join(
    await h.app.evaluate(({ app }) => app.getPath('userData')),
    'storage',
    'documents',
    'venues'
  )
  const folder = readdirSync(storage).find((name) => name.endsWith('-berghain'))
  expect(folder).toBeTruthy()
  expect(existsSync(join(storage, folder!, 'Bühnenplan.pdf'))).toBe(true)

  // The company link opens the company page, whose venues tab lists this venue
  await page.getByRole('tab', { name: 'Übersicht' }).click()
  await page.getByRole('link', { name: 'Live Music Berlin GmbH' }).click()
  await expect(page.getByRole('heading', { name: 'Live Music Berlin GmbH' })).toBeVisible()
  await page.getByRole('tab', { name: 'Clubs / Festivals' }).click()
  await page.getByRole('table', { name: 'Clubs und Festivals der Firma' }).getByText(VENUE).click()
  await expect(page.getByRole('heading', { name: VENUE })).toBeVisible()
})

test('search palette and event page open the venue page', async () => {
  const { page } = h
  await page.getByRole('button', { name: 'Alles suchen (Ctrl+K)' }).click()
  await page.getByPlaceholder('Seiten, Einträge oder Aktionen suchen…').fill('Whisky')
  await page.getByRole('option', { name: /The Whisky a Go Go/ }).click()
  await expect(page.getByRole('heading', { name: 'The Whisky a Go Go' })).toBeVisible()

  // From the LA event back to its venue via the Club / Festival card
  await page.getByRole('tab', { name: 'Events' }).click()
  await page
    .getByRole('table', { name: 'Events des Clubs' })
    .getByText('Midnight Symphony - LA Showcase')
    .click()
  await expect(page.getByRole('heading', { name: 'Midnight Symphony - LA Showcase' })).toBeVisible()
  await page.locator('a[href*="/venues/"]', { hasText: 'Ansehen' }).click()
  await expect(page.getByRole('heading', { name: 'The Whisky a Go Go' })).toBeVisible()
  // The link does not know the kind: the page moves itself below the Clubs list
  await expect(page).toHaveURL(/#\/clubs\/\d+$/)
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(
    'The Whisky a Go Go'
  )
})
