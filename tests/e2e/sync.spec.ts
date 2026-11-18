// E2E: two installations sync through a shared folder. Both start with the same demo data, so
// joining must find every record on both sides and add nothing twice; afterwards a new band on
// one computer reaches the other.
import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let base: string
let shared: string
let dataA: string
let dataB: string

test.beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'bookingum-sync-'))
  shared = join(base, 'Google Drive')
  dataA = join(base, 'buero')
  dataB = join(base, 'laptop')
  for (const dir of [shared, dataA, dataB]) mkdirSync(dir, { recursive: true })
})

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

const counts = (userData: string) => {
  const db = new Database(join(userData, 'data', 'bookingum.db'), { readonly: true })
  try {
    const n = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    return {
      band: n('band'),
      person: n('person'),
      company: n('company'),
      venue: n('venue'),
      deal_memo: n('deal_memo'),
      invoice: n('invoice')
    }
  } finally {
    db.close()
  }
}

async function openSync(h: AppHandle) {
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, shared)
  await h.page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await h.page.getByRole('tab', { name: 'Daten' }).click()
}

test('sets up, joins without duplicates and carries a new band across', async () => {
  test.setTimeout(180_000)
  // the first computer sets up the sync
  const a = await launchApp({ userData: dataA })
  await a.page.waitForSelector('text=Dashboard', { timeout: 20_000 })
  const before = counts(dataA)
  await openSync(a)
  await a.page.locator('#settings-sync').getByRole('button', { name: 'Ordner wählen…' }).click()
  await a.page.getByRole('button', { name: 'Einrichten', exact: true }).click()
  await expect(a.page.getByText('Gemeinsamer Ordner')).toBeVisible({ timeout: 20_000 })
  await a.close()

  // the second computer, with the same demo data of its own, joins (the app restarts)
  const b = await launchApp({ userData: dataB })
  await b.page.waitForSelector('text=Dashboard', { timeout: 20_000 })
  await openSync(b)
  // the test starts the app again itself; a relaunched one would hold the data folder's lock
  await b.app.evaluate(({ app }) => {
    app.relaunch = (() => {}) as never
  })
  await b.page.locator('#settings-sync').getByRole('button', { name: 'Ordner wählen…' }).click()
  await b.page.getByRole('button', { name: 'Zusammenführen und neu starten' }).click()
  await expect(b.page.getByText('Daten zusammengeführt')).toBeVisible({ timeout: 30_000 })
  await b.app.waitForEvent('close', { timeout: 30_000 }).catch(() => {})
  await b.close().catch(() => {})
  expect(counts(dataB)).toEqual(before)

  // after the restart B is in the sync; a band added there arrives on A
  const b2 = await launchApp({ userData: dataB })
  await b2.page.waitForSelector('text=Dashboard', { timeout: 20_000 })
  await openSync(b2)
  await expect(b2.page.getByText('(dieser Computer)')).toBeVisible({ timeout: 20_000 })
  await b2.close()
  // a band written while B is closed: the change triggers log it, the next start sends it
  const db = new Database(join(dataB, 'data', 'bookingum.db'))
  const prefix = Number(
    (db.prepare("SELECT value FROM sync_meta WHERE key = 'id_prefix'").get() as { value: string })
      .value
  )
  const companyId = (db.prepare('SELECT id FROM company LIMIT 1').get() as { id: number }).id
  db.prepare('INSERT INTO band (id, name, company_id) VALUES (?, ?, ?)').run(
    prefix * 2 ** 33 + 1,
    'Vom Laptop angelegt',
    companyId
  )
  db.close()
  const b3 = await launchApp({ userData: dataB })
  await b3.page.waitForSelector('text=Dashboard', { timeout: 20_000 })
  await openSync(b3)
  await b3.page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
  await expect(b3.page.getByText('Abgeglichen', { exact: true })).toBeVisible({ timeout: 20_000 })
  await b3.close()

  const a2 = await launchApp({ userData: dataA })
  await a2.page.waitForSelector('text=Dashboard', { timeout: 20_000 })
  await openSync(a2)
  await a2.page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
  await expect(a2.page.getByText('Abgeglichen', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(a2.page.getByText('(dieser Computer)')).toBeVisible()
  await a2.page.getByRole('link', { name: 'Bands' }).first().click()
  await expect(a2.page.getByText('Vom Laptop angelegt')).toBeVisible({ timeout: 10_000 })
  await a2.close()
  // nothing doubled: A has its data plus the one new band
  expect(counts(dataA)).toEqual({ ...before, band: before.band + 1 })
})
