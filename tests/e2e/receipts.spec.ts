// E2E (#225): receipts. Two files are picked at once (open dialog stubbed in main): an e-invoice
// PDF fills date, amount and supplier, a photo becomes a PDF. Both are saved one after the
// other, show in the list and its filter, and appear on the Dashboard once the default company
// has a DATEV address for their category. No mail is sent (no account in a fresh profile).
import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { PDFDocument } from 'pdf-lib'
import { embedFacturX } from '../../src/main/einvoice/facturx'
import { CII_INVOICE } from '../helpers/receivedEInvoices'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let fixtureDir: string
const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')

// A 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

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
  fixtureDir = mkdtempSync(join(tmpdir(), 'bookingum-receipts-'))
  const doc = await PDFDocument.create()
  doc.addPage()
  const invoicePdf = join(fixtureDir, 'Eingangsrechnung.pdf')
  writeFileSync(invoicePdf, await embedFacturX(await doc.save(), CII_INVOICE, { title: 'R' }))
  const photo = join(fixtureDir, 'Tankquittung.png')
  writeFileSync(photo, PNG)

  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  await h.app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as never
    },
    [invoicePdf, photo]
  )
})

test.afterAll(async () => {
  await h.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

test('stores receipts from an e-invoice and a photo and lists them for DATEV', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Belege' }).first().click()
  await expect(page.getByRole('heading', { name: 'Belege' })).toBeVisible()
  await page.getByRole('button', { name: '+ Belege hinzufügen' }).click()

  // 1 of 2: the e-invoice, read from its XML
  const dialog = page.getByRole('dialog', { name: /Beleg speichern/ })
  await expect(dialog).toContainText('1 von 2')
  await expect(dialog.getByText('E-Rechnung', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Belegdatum')).toHaveValue('2026-11-03')
  await expect(dialog.getByLabel('Betrag (brutto)')).toHaveValue('1.190,00')
  await expect(dialog.getByLabel('Rechnungs- / Belegnummer')).toHaveValue('RE-2026-0042')
  await expect(dialog.getByRole('button', { name: 'Firma aus E-Rechnung anlegen…' })).toBeVisible()
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: join(shots, 'receipts-einvoice.png') })
  await dialog.getByRole('button', { name: 'Speichern' }).click()

  // 2 of 2: the photo, named by hand, stored as a PDF
  await expect(dialog).toContainText('2 von 2')
  await expect(dialog.getByText('wird als PDF gespeichert')).toBeVisible()
  await dialog.getByLabel('Dateiname').fill('Tankstelle Beispiel')
  await dialog.getByLabel('Betrag (brutto)').fill('62,40')
  await dialog.getByLabel('Belegart').click()
  await page.getByRole('option', { name: 'Kreditkartenbelege' }).click()
  await dialog.getByRole('button', { name: 'Speichern' }).click()
  await expect(dialog).toBeHidden()

  const table = page.getByRole('table')
  await expect(table).toContainText('Bühnentechnik Beispiel GmbH & Co. KG')
  await expect(table).toContainText('Tankstelle Beispiel.pdf')
  await expect(table).toContainText('62,40')
  await page.screenshot({ path: join(shots, 'receipts-list.png') })

  // Filter by category
  await page.getByRole('combobox', { name: 'Belegart' }).click()
  await page.getByRole('option', { name: 'Kreditkartenbelege' }).click()
  await expect(table).toContainText('Tankstelle Beispiel.pdf')
  await expect(table).not.toContainText('Bühnentechnik')

  // A DATEV address for credit card receipts puts that receipt on the Dashboard
  const own = (await trpc('company.getDefaultForInvoicing', 'query', undefined)) as {
    id: number
  } | null
  expect(own).not.toBeNull()
  await trpc('datev.setUploadEmail', 'mutation', {
    companyId: own!.id,
    category: 'credit_card',
    datevUploadEmail: 'kreditkarte@duo.example.test'
  })
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  const card = page.getByRole('region', { name: 'Belege noch nicht an DATEV übergeben' })
  await expect(card).toContainText('Tankstelle Beispiel')
  await expect(card).not.toContainText('Bühnentechnik')

  // Without a mail account the send is refused with a reason, nothing is recorded
  await card.getByRole('button', { name: 'An DATEV übergeben' }).click()
  await expect(page.getByText('Nicht an DATEV übergeben', { exact: true })).toBeVisible()
  await expect(card).toContainText('Tankstelle Beispiel')
})
