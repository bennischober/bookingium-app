// E2E (#103): Agenturbuchungen - the seeded ones show in their own view of the event list,
// an agency export imports through the dialog (new and unchanged rows by booking number),
// and a booking can be removed. Fictitious data only.
import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { toCsv } from '../../src/main/csv/csv'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string

const isoInDays = (offset: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}
const german = (iso: string): string => iso.split('-').reverse().join('.')

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-agency-'))
  const file = join(fixtureDir, 'Agentur-Export.csv')
  const rows = [
    ['Nr', 'Künstler', 'Datum', 'Spielstätte', 'PLZ', 'Ort', 'Status'],
    ['X1', 'The Electric Waves', german(isoInDays(60)), 'Halle Muster', '50667', 'Köln', 'fix'],
    [
      'X2',
      'Midnight Symphony',
      german(isoInDays(61)),
      'Club Beispiel',
      '10115',
      'Berlin',
      'Option'
    ],
    ['X3', 'Unbekannte Band', german(isoInDays(62)), 'Club Beispiel', '10115', 'Berlin', '']
  ]
  writeFileSync(file, toCsv(rows, ';'), 'utf8')

  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('lists, imports and removes agency bookings', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.getByRole('button', { name: 'Agenturbuchungen', exact: true }).click()
  const view = page.getByRole('region', { name: 'Agenturbuchungen' })
  // The seed's three, the cancelled one included
  await expect(view.getByText('Beispielhalle')).toBeVisible()
  await expect(view.getByText('Sommerwiese Open Air')).toBeVisible()
  await expect(view.getByText('Abgesagt')).toBeVisible()

  await view.getByRole('button', { name: 'Importieren' }).click()
  const dialog = page.getByRole('dialog', { name: 'Agenturbuchungen importieren' })
  await dialog.getByRole('button', { name: 'Datei auswählen…' }).click()
  await dialog.getByLabel('Agentur', { exact: true }).fill('Zweite Agentur')
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
  await expect(dialog.getByText('Band ist nicht angelegt')).toBeVisible()
  await dialog.getByRole('button', { name: 'Importieren' }).click()
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click()

  await expect(view.getByText('Halle Muster')).toBeVisible()
  await expect(view.getByText('Club Beispiel')).toBeVisible()
  // Two agencies now: the filter appears
  await expect(view.getByRole('combobox', { name: 'Agentur' })).toBeVisible()

  // The same file again: nothing new, the column choice and agency are remembered
  await view.getByRole('button', { name: 'Importieren' }).click()
  await dialog.getByRole('button', { name: 'Datei auswählen…' }).click()
  await expect(dialog.getByLabel('Agentur', { exact: true })).toHaveValue('Zweite Agentur')
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
  await expect(dialog.getByText('Band ist nicht angelegt')).toBeVisible()
  await dialog.getByRole('button', { name: 'Zurück' }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  const row = view.getByRole('row').filter({ hasText: 'Halle Muster' })
  await row.getByRole('button', { name: 'Entfernen' }).click()
  const confirm = page.getByRole('dialog').filter({ hasText: 'entfernen?' })
  await confirm.getByRole('button', { name: 'Entfernen' }).click()
  await expect(view.getByText('Halle Muster')).toBeHidden()
  await expect(view.getByText('Club Beispiel')).toBeVisible()
})
