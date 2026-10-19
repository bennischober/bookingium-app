// E2E: the band page (tabs, members, events, contracts) and documents for
// bands and events in readable folders (storage/documents/<type>/<id>-<name>/).
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

const BAND = 'The Electric Waves'
const EVENT = 'The Electric Waves - Berlin Tour'

/** Next "Dateien auswählen" returns this file */
async function pickFile(name: string): Promise<string> {
  const file = join(fixtureDir, name)
  writeFileSync(file, `${name} content`)
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
  return file
}

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-docs-'))
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('band page shows members, events, contracts and documents', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Bands' }).first().click()
  await page.locator('tr', { hasText: BAND }).first().click()

  await expect(page.getByRole('heading', { name: BAND })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(BAND)
  await expect(page.getByText('Soundwave Records')).toBeVisible()

  await page.getByRole('tab', { name: 'Mitglieder' }).click()
  await expect(page.getByRole('button', { name: 'Person hinzufügen' })).toBeVisible()
  await expect(page.getByText('John Rockstar')).toBeVisible()

  await page.getByRole('tab', { name: 'Events' }).click()
  await expect(page.getByRole('table', { name: 'Events der Band' })).toContainText(EVENT)

  await page.getByRole('tab', { name: 'Managementverträge' }).click()
  await expect(page.getByRole('button', { name: '+ Vertrag anlegen' })).toBeVisible()

  // Band document: copied into documents/bands/<id>-the-electric-waves/
  await page.getByRole('tab', { name: 'Dokumente' }).click()
  await pickFile('Stageplot.pdf')
  await page.getByRole('button', { name: 'Dateien auswählen' }).click()
  const bandDocs = page.getByRole('list', { name: 'Dokumente der Band' })
  await expect(bandDocs).toContainText('Stageplot.pdf')
  await bandDocs.getByRole('combobox', { name: 'Art von Stageplot.pdf' }).click()
  await page.getByRole('option', { name: 'Stageplot' }).click()
  await expect(page.getByText('Dokument aktualisiert')).toBeVisible()

  const storage = join(
    await h.app.evaluate(({ app }) => app.getPath('userData')),
    'storage',
    'documents'
  )
  const bandFolder = readdirSync(join(storage, 'bands')).find((name) =>
    name.endsWith('-the-electric-waves')
  )
  expect(bandFolder).toBeTruthy()
  expect(existsSync(join(storage, 'bands', bandFolder!, 'Stageplot.pdf'))).toBe(true)

  // Event document: shown on the band page under "Aus Events"
  await page.getByRole('tab', { name: 'Events' }).click()
  await page.getByRole('table', { name: 'Events der Band' }).getByText(EVENT).click()
  await page.getByRole('tab', { name: 'Dokumente' }).click()
  await pickFile('Vertrag Berlin.pdf')
  await page.getByRole('button', { name: 'Dateien auswählen' }).click()
  await expect(page.getByRole('list', { name: 'Dokumente' })).toContainText('Vertrag Berlin.pdf')
  const eventFolder = readdirSync(join(storage, 'events')).find((name) =>
    name.includes('the-electric-waves-berlin-tour')
  )
  expect(eventFolder).toMatch(/^\d+-\d{4}-\d{2}-\d{2}-the-electric-waves-berlin-tour$/)

  // Back to the band (history), its documents tab lists the event's file
  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await page.getByRole('tab', { name: 'Dokumente' }).click()
  const fromEvents = page.getByRole('region', { name: 'Dokumente aus Events' })
  await expect(fromEvents).toContainText(EVENT)
  await expect(fromEvents).toContainText('Vertrag Berlin.pdf')

  // Deleting removes the file
  await bandDocs.getByRole('button', { name: 'Stageplot.pdf löschen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click()
  await expect(bandDocs).toBeHidden()
  expect(existsSync(join(storage, 'bands', bandFolder!, 'Stageplot.pdf'))).toBe(false)
})
