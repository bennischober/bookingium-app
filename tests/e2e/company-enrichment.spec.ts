// E2E (#236): a plain PDF invoice of a known company with empty fields is saved as a receipt;
// a toast offers what the invoice adds, the confirmation lists it, and the company page shows
// it afterwards. Fictitious data and the public test IBAN only.
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string
const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')

async function trpc(path: string, type: 'query' | 'mutation', input: unknown): Promise<unknown> {
  return h.page.evaluate(
    ({ path, type, input }) =>
      new Promise((done, fail) => {
        const w = window as unknown as {
          electronTRPC: {
            sendMessage: (m: unknown) => void
            onMessage: (
              cb: (m: {
                id: number
                result?: { data: unknown }
                error?: { message: string }
              }) => void
            ) => void
          }
        }
        const id = Math.floor(Math.random() * 1e9)
        w.electronTRPC.onMessage((m) => {
          if (m.id !== id) return
          if (m.error) fail(new Error(m.error.message))
          else done(m.result?.data)
        })
        w.electronTRPC.sendMessage({
          method: 'request',
          operation: { id, type, path, input, context: {} }
        })
      }),
    { path, type, input }
  )
}

test.beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-enrich-'))
  const doc = await PDFDocument.create()
  const page = doc.addPage()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  ;[
    'BEISPIEL RECORDS GmbH - Beispielweg 12 - 50667 Koeln',
    'info@beispiel-records.example.com',
    'USt-IdNr. DE135792468',
    // the seed's own company has this test IBAN: an invoice's recipient data is never taken
    'IBAN DE89370400440532013000',
    'Rechnung Nr. 2026-17 vom 10.11.2026',
    'Betrag: 119,00 EUR'
  ].forEach((line, index) => page.drawText(line, { x: 40, y: 780 - index * 16, size: 10, font }))
  const file = join(fixtureDir, 'Rechnung Beispiel Records.pdf')
  writeFileSync(file, await doc.save())

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

test('completes a known company from an invoice saved as a receipt', async () => {
  const { page } = h
  await trpc('company.create', 'mutation', { name: 'Beispiel Records GmbH' })

  await page.getByRole('link', { name: 'Belege' }).first().click()
  await page.getByRole('button', { name: '+ Belege hinzufügen' }).click()
  const dialog = page.getByRole('dialog', { name: /Beleg speichern/ })
  await dialog.getByLabel('Betrag (brutto)').fill('119,00')
  await dialog.getByRole('button', { name: 'Speichern' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByText('Beispiel Records GmbH: 3 Angaben aus der Rechnung')).toBeVisible()
  await page.getByRole('button', { name: 'Ergänzen…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Beispiel Records GmbH ergänzen' })
  await expect(confirm).toContainText('Beispielweg 12, 50667 Koeln')
  await expect(confirm).toContainText('DE135792468')
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: join(shots, 'company-enrichment.png') })
  await confirm.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(page.getByText('Beispiel Records GmbH ergänzt')).toBeVisible()

  const companies = (await trpc('company.getListItems', 'query', undefined)) as Array<{
    id: number
    name: string
  }>
  const id = companies.find((c) => c.name === 'Beispiel Records GmbH')!.id
  const company = (await trpc('company.getById', 'query', { id })) as {
    vatId: string
    address: { city: string } | null
  }
  expect(company.vatId).toBe('DE135792468')
  expect(company.address?.city).toBe('Koeln')
})
