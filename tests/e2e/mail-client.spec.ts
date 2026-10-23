// E2E: the mail client end to end (renderer → tRPC → main → utility process
// → mail core → IMAP) against the local Dovecot/Mailpit sandbox from the
// email prototype (docker compose, ports 10143/10144/1025). Skipped when the
// sandbox is not running. Never touches a real mailbox.
import { test, expect } from '@playwright/test'
import { connect } from 'net'
import { readFileSync } from 'fs'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

const SANDBOX = { host: '127.0.0.1', port: 10143, ionosLikePort: 10144 }
// Fixture account of the sandbox Dovecot (not a real mailbox)
const SANDBOX_USER = 'testuser@example.test'
const SANDBOX_PASS = 'testpass'

function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: SANDBOX.host, port, timeout: 1000 })
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => (socket.destroy(), resolve(false)))
  })
}

let h: AppHandle
let userData: string

/** A tRPC call the way the renderer's ipcLink makes it */
function trpc<T>(type: 'query' | 'mutation', path: string, input?: unknown): Promise<T> {
  return h.page.evaluate(
    ({ type, path, input }) =>
      new Promise((resolve, reject) => {
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
          if (m.error) reject(new Error(m.error.message))
          else resolve(m.result?.data)
        })
        w.electronTRPC.sendMessage({
          method: 'request',
          operation: { id, type, path, input, context: {} }
        })
      }),
    { type, path, input }
  ) as Promise<T>
}

const mail = <T>(method: string, ...args: unknown[]): Promise<T> =>
  trpc<T>('mutation', 'mail.call', { method, args })

async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 60_000
): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (ok(v)) return v
    if (Date.now() > until) throw new Error('timeout waiting for the mail client')
    await new Promise((r) => setTimeout(r, 500))
  }
}

test.beforeAll(async () => {
  test.skip(!(await reachable(SANDBOX.port)), 'mail sandbox (Dovecot) is not running')
  h = await launchApp()
  userData = await h.app.evaluate(({ app }) => app.getPath('userData'))
})

test.afterAll(async () => {
  await h?.close()
})

type Account = { id: string; kind: string }
type Folder = { id: string; path: string; totalCount: number; children: Folder[] }

let sandboxId: string
let readOnlyId: string | undefined

test('a sandbox account is saved with an encrypted password', async () => {
  const account = await trpc<Account>('mutation', 'mail.accounts.save', {
    kind: 'sandbox',
    host: SANDBOX.host,
    port: SANDBOX.port,
    user: SANDBOX_USER,
    email: SANDBOX_USER,
    password: SANDBOX_PASS
  })
  sandboxId = account.id
  expect(account).not.toHaveProperty('password')

  const stored = readFileSync(join(userData, 'mail', 'accounts.json'), 'utf-8')
  expect(stored).not.toContain(SANDBOX_PASS)
  expect(JSON.parse(stored)[0].password.length).toBeGreaterThan(0)
})

test('the worker syncs folders and serves messages over IPC', async () => {
  const folders = await waitFor(
    () => mail<Folder[]>('getFolders', sandboxId),
    (f) => f.some((x) => x.path === 'INBOX' && x.totalCount > 0)
  )
  const inbox = folders.find((f) => f.path === 'INBOX')!

  const list = await waitFor(
    () => mail<{ id: number }[]>('listMessages', inbox.id, { offset: 0, limit: 5 }, sandboxId),
    (l) => l.length > 0
  )
  // Sanitizing (jsdom + DOMPurify) runs in the worker
  const detail = await mail<{ id: number; bodyKind: string }>('getMessage', list[0].id, sandboxId)
  expect(detail.id).toBe(list[0].id)
  expect(['html', 'text']).toContain(detail.bodyKind)

  // Bytes cross both process boundaries intact
  const raw = await mail<Uint8Array>('getRawEml', list[0].id, sandboxId)
  expect(raw).toBeInstanceOf(Uint8Array)
  expect(raw.length).toBeGreaterThan(0)

  const result = await mail<{ total: number; elapsedMs: number }>(
    'search',
    { query: '', limit: 10 },
    sandboxId
  )
  expect(result.total).toBeGreaterThan(0)
})

const openMailPage = async () => {
  await h.page.goto(`${h.page.url().split('#')[0]}#/mail`)
  // Accounts saved over raw IPC above are not in the page's cache yet
  await h.page.reload()
  await expect(h.page.getByRole('heading', { name: 'E-Mail', level: 1 })).toBeVisible()
}

test('the mail page shows folders, messages and a sandboxed reader', async () => {
  const { page } = h
  await openMailPage()
  // Default window size: a folder picker instead of the tree
  await expect(page.getByRole('combobox', { name: 'Ordner wählen' })).toContainText('Posteingang', {
    timeout: 30_000
  })

  const messages = page.getByRole('listbox', { name: 'Nachrichten' })
  await messages.getByRole('option').first().click({ timeout: 30_000 })
  const reader = page.getByRole('article', { name: 'E-Mail' })
  await expect(reader.getByRole('heading', { level: 2 })).toBeVisible()
  // Wider windows show the folder tree
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
  await expect(
    page.getByRole('list', { name: 'Ordner' }).locator('[aria-current="true"]')
  ).toContainText('Posteingang')
  // HTML mail: no scripts and no same-origin access in the frame
  const frame = reader.locator('iframe')
  if (await frame.count()) {
    await expect(frame).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
  }
  // Sandbox accounts can write
  await expect(page.getByRole('button', { name: 'In den Papierkorb (Entf)' })).toBeVisible()
  await expect(page.getByRole('note').filter({ hasText: 'Nur lesen' })).toHaveCount(0)

  // Arrow keys move through the list
  await messages.press('ArrowDown')
  await expect(messages.getByRole('option', { selected: true })).toHaveCount(1)

  await page.getByRole('searchbox', { name: 'E-Mails durchsuchen' }).fill('test')
  await expect(page.getByText(/\d+ Treffer · \d+ ms/)).toBeVisible()
})

test('a read-only account refuses writes', async () => {
  test.skip(!(await reachable(SANDBOX.ionosLikePort)), 'IONOS-like sandbox is not running')
  const readOnly = await trpc<Account>('mutation', 'mail.accounts.save', {
    kind: 'production-readonly',
    host: SANDBOX.host,
    port: SANDBOX.ionosLikePort,
    user: SANDBOX_USER,
    email: SANDBOX_USER,
    password: SANDBOX_PASS
  })
  const folders = await waitFor(
    () => mail<Folder[]>('getFolders', readOnly.id),
    (f) => f.some((x) => x.path === 'INBOX' && x.totalCount > 0)
  )
  const inbox = folders.find((f) => f.path === 'INBOX')!
  const list = await waitFor(
    () => mail<{ id: number }[]>('listMessages', inbox.id, { offset: 0, limit: 1 }, readOnly.id),
    (l) => l.length > 0
  )
  await expect(mail('markRead', [list[0].id], true, readOnly.id)).rejects.toThrow(
    /read-only|guard|not allowed|refus/i
  )
  await expect(mail('deleteToTrash', [list[0].id], readOnly.id)).rejects.toThrow()
  readOnlyId = readOnly.id
})

test('the mail page offers no writes for a read-only account', async () => {
  test.skip(!readOnlyId, 'no read-only account')
  const { page } = h
  await openMailPage()
  await page.getByRole('combobox', { name: 'Postfach' }).click()
  await page.getByRole('option').nth(1).click()
  await expect(page.getByRole('note').filter({ hasText: 'Nur lesen' })).toBeVisible()

  const inbox = (await mail<Folder[]>('getFolders', readOnlyId)).find((f) => f.path === 'INBOX')!
  const [first] = await mail<{ id: number; isRead: boolean }[]>(
    'listMessages',
    inbox.id,
    { offset: 0, limit: 1 },
    readOnlyId
  )
  await page
    .getByRole('listbox', { name: 'Nachrichten' })
    .locator(`[data-message-id="${first.id}"]`)
    .click({ timeout: 30_000 })
  await expect(page.getByRole('article', { name: 'E-Mail' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'In den Papierkorb (Entf)' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Original speichern (.eml)' })).toBeVisible()
  // Opening a mail does not mark it as read on the server
  const after = await mail<{ isRead: boolean }>('getMessage', first.id, readOnlyId)
  expect(after.isRead).toBe(first.isRead)
})

test('the settings list the mail accounts', async () => {
  const { page } = h
  await page.goto(`${page.url().split('#')[0]}#/settings?tab=email`)
  const list = page.getByRole('list', { name: 'E-Mail-Konten' })
  await expect(list.getByRole('listitem')).toHaveCount(readOnlyId ? 2 : 1)
  if (readOnlyId) await expect(list.getByText('Nur lesen')).toBeVisible()
})

test('unknown methods are refused before reaching the core', async () => {
  await expect(mail('close')).rejects.toThrow()
  await expect(mail('replayPendingOps')).rejects.toThrow()
})
