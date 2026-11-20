// E2E: the event list shows the venue's city and past shows lighter; a step ticked
// "extern erledigt" on the event page leaves the open points and shows in the status line.
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')
const fixtureDir = mkdtempSync(join(tmpdir(), 'bookingium-external-'))
const signed = join(fixtureDir, 'Vertrag unterschrieben.pdf')
let h: AppHandle

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true })
  h = await launchApp()
  await h.page.setViewportSize({ width: 1400, height: 900 })
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

const EVENT = 'The Electric Waves - Berlin Tour'
const PAST = 'Midnight Symphony - LA Showcase'
const OPEN = 'Vertrag am 02.11.2026 verschickt, noch nicht unterschrieben zurück'

async function openEvent(name: string) {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.locator('tr', { hasText: name }).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

test('a past show looks lighter in the event list, with its city', async () => {
  const { page } = h
  // Move one show into the past
  await openEvent(PAST)
  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  await page.getByLabel('Datum', { exact: true }).fill('2026-10-01')
  await page.getByRole('button', { name: 'Alles speichern' }).click()
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toBeVisible()

  await page.getByRole('link', { name: 'Events' }).first().click()
  await expect(page.getByRole('columnheader', { name: 'Ort' })).toBeVisible()
  const past = page.locator('tr', { hasText: PAST }).first()
  await expect(past).toHaveClass(/text-muted-foreground/)
  await expect(page.locator('tr', { hasText: EVENT }).first()).not.toHaveClass(
    /text-muted-foreground/
  )
  await page.screenshot({ path: join(shots, 'event-list-place-past.png') })
})

test('a contract ticked "extern erledigt" is no open point any more', async () => {
  const { page } = h
  await openEvent(EVENT)
  await page.getByRole('tab', { name: 'Geld' }).click()
  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  await page.getByLabel('Vertrag verschickt am').fill('2026-11-02')
  await page.getByRole('button', { name: 'Alles speichern' }).click()
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toBeVisible()

  const eventItems = page.getByRole('region', { name: 'Offene Punkte des Events' })
  await expect(eventItems.getByRole('link', { name: OPEN })).toBeVisible()
  await page.screenshot({ path: join(shots, 'event-external-before.png') })

  // The tick saves at once (no Bearbeiten needed)
  await page.getByLabel('Vertrag extern erledigt').click()
  await expect(eventItems.getByRole('link', { name: OPEN })).toHaveCount(0)
  await expect(page.getByLabel('Vertrag extern erledigt')).toBeChecked()
  await page.screenshot({ path: join(shots, 'event-external-ticked.png') })

  // The status line on the overview says so
  await page.getByRole('tab', { name: 'Übersicht' }).click()
  await expect(page.getByText('extern erledigt').first()).toBeVisible()
  await page.screenshot({ path: join(shots, 'event-external-overview.png') })

  // Unticked, the open point is back
  await page.getByRole('tab', { name: 'Geld' }).click()
  await page.getByLabel('Vertrag extern erledigt').click()
  await expect(page.getByLabel('Vertrag extern erledigt')).not.toBeChecked()
  await expect(eventItems.getByRole('link', { name: OPEN })).toBeVisible()
})

test('the signed contract can be attached at the tick, which ticks it', async () => {
  const { page } = h
  writeFileSync(signed, '%PDF-1.4\n%%EOF\n')
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, signed)

  // Still on the Geld tab, the tick unset by the test before
  const eventItems = page.getByRole('region', { name: 'Offene Punkte des Events' })
  await expect(page.getByLabel('Vertrag extern erledigt')).not.toBeChecked()
  await page.getByRole('button', { name: 'Vertrag: Datei hinzufügen' }).click()
  await expect(page.getByLabel('Vertrag extern erledigt')).toBeChecked()
  await expect(eventItems.getByRole('link', { name: OPEN })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '1 Datei' })).toBeVisible()
  await page.screenshot({ path: join(shots, 'event-external-file.png') })

  // The count leads to the Dokumente tab, where the file is typed Vertrag
  await page.getByRole('button', { name: '1 Datei' }).click()
  await expect(page.getByRole('tab', { name: 'Dokumente' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(
    page.getByRole('combobox', { name: 'Art von Vertrag unterschrieben.pdf' })
  ).toHaveText('Vertrag')
  await page.screenshot({ path: join(shots, 'event-external-file-documents.png') })
})
