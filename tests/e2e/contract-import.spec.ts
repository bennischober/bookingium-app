// E2E: a contract uploaded to an event is read at once – the promoter company, its contact and
// the deal are offered – and afterwards the contract shows at the promoter too ("Verträge &
// Dokumente"), where it can be assigned to further records. All names are invented.
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')
const fixtureDir = mkdtempSync(join(tmpdir(), 'bookingium-contract-'))
const contract = join(fixtureDir, 'Gastspielvertrag Muster.txt')
let h: AppHandle

const EVENT = 'The Electric Waves - Berlin Tour'
const PROMOTER = 'Muster Konzerte GmbH'

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true })
  writeFileSync(
    contract,
    [
      'GASTSPIELVERTRAG',
      'zwischen',
      PROMOTER,
      'Musterweg 11',
      '12345 Musterstadt',
      'vertreten durch den Geschäftsführer Max Promo',
      'Tel.: +49 40 000 0001',
      'E-Mail: max@muster-konzerte.example.test',
      '– nachfolgend „Veranstalter“ genannt –',
      'und',
      'Beispiel Booking',
      '– nachfolgend „Agentur“ genannt –',
      '§ 1 Vertragsgegenstand',
      'Garantie: 1.500,00 € netto'
    ].join('\n')
  )
  h = await launchApp()
  await h.page.setViewportSize({ width: 1400, height: 900 })
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('an uploaded contract is read, and then shows at the promoter', async () => {
  const { page } = h
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, contract)

  await page.getByRole('link', { name: 'Events' }).first().click()
  await page.locator('tr', { hasText: EVENT }).first().click()
  await expect(page.getByRole('heading', { name: EVENT })).toBeVisible()
  await page.getByRole('tab', { name: /Dokumente/ }).click()
  await page.getByRole('button', { name: 'Dateien auswählen' }).click()

  // the review opens by itself
  const dialog = page.getByRole('dialog', { name: 'Vertrag einlesen' })
  await expect(dialog).toBeVisible()
  const company = dialog.getByRole('checkbox', {
    name: new RegExp(`Veranstalter ${PROMOTER}`)
  })
  await expect(company).toBeVisible()
  if (!(await company.isChecked())) await company.check()
  const person = dialog.getByRole('checkbox', { name: /Max Promo/ })
  if (!(await person.isChecked())) await person.check()
  await page.screenshot({ path: join(shots, 'contract-import-review.png') })
  await dialog.getByRole('button', { name: /^Übernehmen/ }).click()
  await expect(dialog).toBeHidden()

  // the promoter has the contract under "Verträge & Dokumente"
  await page.getByRole('link', { name: 'Firmen' }).first().click()
  await page.locator('tr', { hasText: PROMOTER }).first().click()
  await expect(page.getByRole('heading', { name: PROMOTER })).toBeVisible()
  await page.getByRole('tab', { name: /Dokumente/ }).click()
  const related = page.getByRole('region', { name: 'Verträge & Dokumente' })
  await expect(related.getByText('Gastspielvertrag Muster.txt')).toBeVisible()
  await expect(related.getByText(EVENT).first()).toBeVisible()
  await page.screenshot({ path: join(shots, 'contract-import-company.png') })

  // its contact is the company's Ansprechpartner now
  await page.getByRole('tab', { name: /Übersicht/ }).click()
  await expect(page.getByText('Max Promo').first()).toBeVisible()
})

test('a document can be assigned to further records by search', async () => {
  const { page } = h
  await page.getByRole('tab', { name: /Dokumente/ }).click()
  const related = page.getByRole('region', { name: 'Verträge & Dokumente' })
  await related.getByRole('button', { name: 'Gastspielvertrag Muster.txt zuordnen' }).click()
  const dialog = page.getByRole('dialog', { name: /zuordnen/ })
  await expect(dialog.getByText(PROMOTER)).toBeVisible()
  await dialog.getByLabel('Eintrag zum Zuordnen suchen').fill('Midnight')
  await dialog.getByRole('button', { name: /Midnight Symphony/ }).first().click()
  await expect(
    dialog.getByRole('region', { name: 'Zugeordnet' }).getByText(/Midnight Symphony/).first()
  ).toBeVisible()
  await page.screenshot({ path: join(shots, 'contract-assign.png') })
  await dialog.getByRole('button', { name: 'Fertig' }).click()
})
