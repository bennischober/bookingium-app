// E2E: the Verteiler page — filters, "Keine Werbung", saved lists, CSV
// export, BCC email and copying (save dialog and clipboard stubbed in main;
// BOOKINGIUM_NO_LAUNCH keeps the mail program closed).
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let outDir: string

// Seed: Berghain (1500, Rock bookings) and The Whisky a Go Go (500,
// Electronic/Indie booking), both run by Live Music Berlin GmbH, Tom Manager
// works at both
const BERGHAIN = 'venue-2@email.example.test'
const WHISKY = 'venue-email@email.example.test'
const PROMOTER = 'info@livemusic-berlin.example.test'
const TOM = 'tom.manager@soundwave.example.test'

test.beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'bookingum-contact-list-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  // Keep the real clipboard untouched; remember what would be copied
  await h.app.evaluate(({ clipboard }) => {
    const store = globalThis as { copied?: string }
    clipboard.writeText = ((text: string) => {
      store.copied = text
    }) as never
  })
})

test.afterAll(async () => {
  await h.close()
  rmSync(outDir, { recursive: true, force: true })
})

const copied = () => h.app.evaluate(() => (globalThis as { copied?: string }).copied ?? '')

test('builds, saves and exports a mailing list', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Verteiler' }).first().click()
  await expect(page.getByRole('heading', { name: 'Verteiler' })).toBeVisible()
  // The filter panel starts closed on narrow windows
  const filterButton = page.getByRole('button', { name: 'Filter' })
  if ((await filterButton.getAttribute('aria-pressed')) !== 'true') await filterButton.click()

  const table = page.locator('tbody')
  for (const email of [BERGHAIN, WHISKY, PROMOTER, TOM]) {
    await expect(table.getByText(email, { exact: true })).toBeVisible()
  }
  await expect(page.locator('tr', { hasText: TOM })).toContainText('Ansprechpartner')

  // Size: only Berghain is that large
  await page.getByLabel('Kapazität ab').fill('1000')
  await expect(table.getByText(WHISKY, { exact: true })).toBeHidden()
  await expect(table.getByText(BERGHAIN, { exact: true })).toBeVisible()
  await expect(page.locator('tr', { hasText: TOM })).toContainText('Berghain (Stage Manager)')

  // Recipient type: only the venues' own addresses
  await page.getByRole('button', { name: 'Spielstätte', exact: true }).click()
  await expect(table.getByText(TOM, { exact: true })).toBeHidden()
  await expect(table.locator('tr')).toHaveCount(1)

  // Keine Werbung: out of the list, back in from the dialog
  await page
    .locator('tr', { hasText: BERGHAIN })
    .getByRole('button', { name: 'Keine Werbung' })
    .click()
  await expect(table.getByText(BERGHAIN, { exact: true })).toBeHidden()
  await page.getByRole('button', { name: /1 Adresse mit „Keine Werbung“ ausgeschlossen/ }).click()
  const excluded = page.getByRole('dialog', { name: 'Keine Werbung' })
  await expect(excluded).toContainText(BERGHAIN)
  await excluded.getByRole('button', { name: 'Wieder aufnehmen' }).click()
  await expect(excluded).toContainText('Keine mehr.')
  await page.keyboard.press('Escape')
  await expect(table.getByText(BERGHAIN, { exact: true })).toBeVisible()

  // Save, start over, open it again
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  const nameDialog = page.getByRole('dialog', { name: 'Verteiler speichern' })
  await nameDialog.getByLabel('Name').fill('Große Clubs')
  await nameDialog.getByRole('button', { name: 'Speichern' }).click()
  await expect(nameDialog).toBeHidden()
  const savedSelect = page.getByRole('combobox', { name: 'Gespeicherter Verteiler' })
  await expect(savedSelect).toHaveText('Große Clubs')

  await savedSelect.click()
  await page.getByRole('option', { name: 'Neuer Verteiler' }).click()
  await expect(table.getByText(WHISKY, { exact: true })).toBeVisible()
  await savedSelect.click()
  await page.getByRole('option', { name: 'Große Clubs' }).click()
  await expect(page.getByLabel('Kapazität ab')).toHaveValue('1000')
  await expect(table.locator('tr')).toHaveCount(1)

  // Genre: from the bands that played there
  await savedSelect.click()
  await page.getByRole('option', { name: 'Neuer Verteiler' }).click()
  await page.getByLabel('Genre').click()
  await page.getByRole('option', { name: 'Electronic/Indie' }).click()
  await page.keyboard.press('Escape')
  await expect(table.getByText(WHISKY, { exact: true })).toBeVisible()
  await expect(table.getByText(BERGHAIN, { exact: true })).toBeHidden()

  // CSV for newsletter services
  const file = join(outDir, 'Verteiler.csv')
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, file)
  await page.getByRole('button', { name: 'CSV exportieren' }).click()
  await expect(page.getByText('3 Zeilen exportiert')).toBeVisible()
  const lines = readFileSync(file, 'utf-8').trimEnd().split('\r\n')
  expect(lines[0]).toBe('E-Mail,Vorname,Nachname,Firma,Spielstätte,Ort,Land,Art')
  expect(lines).toHaveLength(4)
  expect(lines.some((line) => line.startsWith(`${TOM},Tom,Manager,`))).toBe(true)

  // BCC email (no mail program in tests) and copying
  await page.getByRole('button', { name: 'E-Mail schreiben' }).click()
  await expect(page.getByText('E-Mail mit 3 Adressen in BCC geöffnet')).toBeVisible()
  await page.getByRole('button', { name: 'Adressen kopieren' }).click()
  await expect(page.getByText('3 Adressen kopiert')).toBeVisible()
  expect((await copied()).split(/[,;] /).sort()).toEqual([PROMOTER, TOM, WHISKY].sort())
})
