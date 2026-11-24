// E2E (#53): a calendar subscribed by address shows in the Bookingium calendar, and the share
// link check finds the Bookingium file behind a web address. A local HTTP server stands in
// for Google/iCloud and for the cloud folder's share link.
import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
let server: Server
let base: string
let outDir: string
const feedFile = () => join(outDir, 'Bookingium.ics')

const pad = (n: number) => String(n).padStart(2, '0')
const today = new Date()
const todayIcs = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`

const teamCalendar = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Example//Test//EN',
  'X-WR-CALNAME:Proben-Kalender',
  'BEGIN:VEVENT',
  'UID:probe@example.test',
  `DTSTART:${todayIcs}T190000`,
  `DTEND:${todayIcs}T210000`,
  'SUMMARY:Bandprobe im Proberaum',
  'LOCATION:Musterstraße 1',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

test.beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'bookingum-subscription-'))
  server = createServer((req, res) => {
    if (req.url === '/team.ics') {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
      res.end(teamCalendar)
    } else if (req.url === '/share/Bookingium.ics' && existsSync(feedFile())) {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
      res.end(readFileSync(feedFile()))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
})

test.afterAll(async () => {
  await h.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(outDir, { recursive: true, force: true })
})

test('subscribes to a calendar and shows its entries', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Kalender' }).click()
  await expect(page.getByText('Noch keine Kalender abonniert.')).toBeVisible()

  await page.getByLabel('Adresse des Kalenders (ICS)').fill(`${base}/team.ics`)
  await page.getByRole('button', { name: 'Abonnieren', exact: true }).click()
  await expect(page.getByText('„Proben-Kalender“ abonniert')).toBeVisible()
  const row = page.getByTestId('calendar-subscription')
  await expect(row.getByLabel('Name des Abos')).toHaveValue('Proben-Kalender')
  await expect(row.getByText(/Zuletzt geladen .* · 1 Einträge/)).toBeVisible()

  // An address without a calendar is refused with the reason
  await page.getByLabel('Adresse des Kalenders (ICS)').fill(`${base}/missing.ics`)
  await page.getByRole('button', { name: 'Abonnieren', exact: true }).click()
  await expect(page.getByText('Der Server antwortet mit HTTP 404.')).toBeVisible()

  // The calendar opens on today: the entry is in the selected day and the agenda
  await page.getByRole('link', { name: 'Kalender' }).first().click()
  const selectedDay = page.getByTestId('selected-day')
  await expect(selectedDay.getByText('Bandprobe im Proberaum')).toBeVisible()
  await expect(selectedDay.getByText('19:00–21:00')).toBeVisible()
  await expect(selectedDay.getByText('Musterstraße 1 · Proben-Kalender')).toBeVisible()

  // Switched off, it leaves the calendar
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Kalender' }).click()
  await page.getByTestId('calendar-subscription').getByRole('switch').click()
  await page.getByRole('link', { name: 'Kalender' }).first().click()
  await expect(page.getByTestId('selected-day')).toBeVisible()
  await expect(page.getByText('Bandprobe im Proberaum')).toHaveCount(0)
})

test('checks the share link of the calendar file', async () => {
  const { page } = h
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, feedFile())

  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'Kalender' }).click()
  await page.getByRole('button', { name: 'Datei festlegen…' }).click()
  await expect(page.getByText('Kalender-Datei wird jetzt aktuell gehalten')).toBeVisible()

  const share = page.getByTestId('calendar-share-link')
  // A temp folder is no cloud folder
  await expect(share.getByText(/liegt in keinem OneDrive-/)).toBeVisible()

  await share.getByLabel('Freigabe-Link der Datei').fill(`${base}/share/nothing.ics`)
  await share.getByRole('button', { name: 'Prüfen' }).click()
  await expect(share.getByRole('alert')).toContainText('HTTP 404')

  await share.getByLabel('Freigabe-Link der Datei').fill(`${base}/share/Bookingium.ics`)
  await share.getByRole('button', { name: 'Prüfen' }).click()
  await expect(share.getByText(/Erreichbar: Bookingium-Kalender mit \d+ Einträgen/)).toBeVisible()
  await expect(share.getByLabel('Abo-Adresse')).toHaveValue(`${base}/share/Bookingium.ics`)

  // Kept across a reload of the page
  await page.reload()
  await page.getByRole('tab', { name: 'Kalender' }).click()
  await expect(page.getByLabel('Abo-Adresse')).toHaveValue(`${base}/share/Bookingium.ics`)
})
