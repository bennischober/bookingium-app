// E2E: the mail client end to end (renderer → tRPC → main → utility process
// → mail core → IMAP) against the local Dovecot/Mailpit sandbox from the
// email prototype (docker compose, ports 10143/10144/1025). Skipped when the
// sandbox is not running. Never touches a real mailbox, nor testuser's: the suite
// logs in as its own sandbox user and seeds that mailbox itself.
import { test, expect } from '@playwright/test'
import { connect, createServer, type AddressInfo } from 'net'
import { readFileSync } from 'fs'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'
import { E2E_MAIL_PASS, E2E_MAIL_USER, seedMailSandbox } from './helpers/mailSandbox'

const SANDBOX = { host: '127.0.0.1', port: 10143, ionosLikePort: 10144 }
const SANDBOX_USER = E2E_MAIL_USER
const SANDBOX_PASS = E2E_MAIL_PASS

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
  await seedMailSandbox(SANDBOX.host, SANDBOX.port)
  if (await reachable(SANDBOX.ionosLikePort)) {
    await seedMailSandbox(SANDBOX.host, SANDBOX.ionosLikePort)
  }
  h = await launchApp()
  userData = await h.app.evaluate(({ app }) => app.getPath('userData'))
})

test.afterAll(async () => {
  await h?.close()
})

type Account = { id: string; kind: string }
type Saved = { test: { ok: boolean; stage?: string }; account?: Account }

/** Saves through the connection test; fails the test when the server refuses the settings */
async function saveAccount(input: Record<string, unknown>): Promise<Account> {
  const saved = await trpc<Saved>('mutation', 'mail.accounts.save', input)
  expect(saved.test).toMatchObject({ ok: true })
  return saved.account!
}
type Folder = {
  id: string
  path: string
  specialUse: string | null
  totalCount: number
  children: Folder[]
}

let sandboxId: string
let readOnlyId: string | undefined

test('a sandbox account is saved with an encrypted password', async () => {
  const account = await saveAccount({
    kind: 'sandbox',
    host: SANDBOX.host,
    port: SANDBOX.port,
    security: 'none',
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

test('the mail panes can be resized and keep their width', async () => {
  const { page } = h
  await openMailPage()
  const list = page.getByRole('region', { name: 'Postfachliste' })
  const splitter = page.getByRole('separator', { name: 'Breite der Nachrichtenliste' })
  const width = async () => Math.round((await list.boundingBox())!.width)
  await expect(splitter).toBeVisible({ timeout: 30_000 })
  const before = await width()

  const box = (await splitter.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 60, y, { steps: 5 })
  await page.mouse.up()
  expect(await width()).toBe(before + 60)

  await splitter.press('ArrowLeft')
  expect(await width()).toBe(before + 44)

  // Remembered across a reload
  await openMailPage()
  await expect.poll(width).toBe(before + 44)

  await splitter.dblclick()
  expect(await width()).toBe(352)

  // Clickable rows and buttons show the hand cursor
  const row = page.getByRole('listbox', { name: 'Nachrichten' }).getByRole('option').first()
  await expect(row).toHaveCSS('cursor', 'pointer', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Filter' })).toHaveCSS('cursor', 'pointer')
})

test('the app sidebar collapses on the mail page and remembers it per page', async () => {
  const { page } = h
  const sidebar = page.getByRole('navigation', { name: 'Hauptnavigation' })
  const expand = page.getByRole('button', { name: 'Seitenleiste ausklappen' })
  const collapse = page.getByRole('button', { name: 'Seitenleiste einklappen' })
  const sidebarWidth = async () => Math.round((await sidebar.boundingBox())!.width)

  await openMailPage()
  // Collapsed by default on the mail page; the items keep their names
  await expect(expand).toBeVisible()
  expect(await sidebarWidth()).toBeLessThan(80)
  await expect(sidebar.getByRole('link', { name: 'E-Mail' })).toBeVisible()

  await expand.click()
  await expect(collapse).toBeVisible()
  expect(await sidebarWidth()).toBeGreaterThan(150)
  await page.keyboard.press('Control+b')
  await expect(expand).toBeVisible()

  // Other pages keep their own setting (expanded), and the mail page stays collapsed
  await sidebar.getByRole('link', { name: 'Dashboard' }).click()
  await expect(collapse).toBeVisible()
  await openMailPage()
  await expect(expand).toBeVisible()
})

test('a mail dragged onto a folder is moved there', async () => {
  const { page } = h
  const count = async (folderId: string) =>
    (await mail<Folder[]>('getFolders', sandboxId)).find((f) => f.id === folderId)!.totalCount
  const folders = await mail<Folder[]>('getFolders', sandboxId)
  const inbox = folders.find((f) => f.path === 'INBOX')!
  // A top-level folder, so the tree shows it without expanding anything
  const target = folders.find((f) => f.path !== 'INBOX' && !f.specialUse)
  test.skip(!target, 'the sandbox has no plain top-level folder')
  // The inbox may still be downloading and growing, so the mail itself is followed;
  // a move keeps its row id
  const targetBefore = target!.totalCount
  const folderOf = async (id: number) =>
    (await mail<{ folderId: string }>('getMessage', id, sandboxId)).folderId

  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
  await openMailPage()
  const row = page.getByRole('listbox', { name: 'Nachrichten' }).getByRole('option').first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  const id = Number(await row.getAttribute('data-message-id'))
  const folderButton = page
    .getByRole('list', { name: 'Ordner' })
    .locator(`button[title="${target!.path}"]`)

  // Its own folder takes no drop
  const inboxButton = page.getByRole('list', { name: 'Ordner' }).locator('button[title="INBOX"]')
  await row.dragTo(inboxButton)
  await expect(page.getByText(/verschoben/)).toHaveCount(0)

  type Op = { id: string; kind: string; state: string; targetFolderPath: string | null }
  const undo = async () => {
    const op = (await mail<Op[]>('listOps', sandboxId)).find(
      (o) => o.kind === 'move' && o.state === 'done' && o.targetFolderPath === target!.path
    )
    if (op) await mail('undoOp', op.id, sandboxId)
  }
  await row.dragTo(folderButton)
  try {
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: /^Nach „.+“ verschoben/ })
    await expect(toast).toBeVisible({ timeout: 30_000 })
    await expect(toast.getByRole('button', { name: 'Rückgängig' })).toBeVisible()
    expect(await folderOf(id)).toBe(target!.id)
    await expect(page.locator(`[data-message-id="${id}"]`)).toHaveCount(0)
    await expect.poll(() => count(target!.id), { timeout: 30_000 }).toBe(targetBefore + 1)

    // Put it back, the way the toast's undo does (the toast may be gone by now)
    await undo()
    await expect.poll(() => folderOf(id), { timeout: 30_000 }).toBe(inbox.id)
    await expect.poll(() => count(target!.id), { timeout: 30_000 }).toBe(targetBefore)
  } finally {
    // The sandbox stays as it was, also when a check above failed
    if ((await folderOf(id).catch(() => null)) === target!.id) await undo()
  }
})

test('a read-only account refuses writes', async () => {
  test.skip(!(await reachable(SANDBOX.ionosLikePort)), 'IONOS-like sandbox is not running')
  // Plain text is accepted for a production account on loopback only
  const readOnly = await saveAccount({
    kind: 'production-readonly',
    host: SANDBOX.host,
    port: SANDBOX.ionosLikePort,
    security: 'none',
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

test('the account dialog tests the connection and saves only what passes', async () => {
  const { page } = h
  const list = page.getByRole('list', { name: 'E-Mail-Konten' })
  const before = await list.getByRole('listitem').count()

  await page.getByRole('button', { name: 'Postfach hinzufügen…' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('E-Mail-Adresse').fill(SANDBOX_USER)
  await dialog.getByLabel('IMAP-Server').fill(SANDBOX.host)
  await dialog.getByRole('combobox', { name: 'Verschlüsselung' }).click()
  await page.getByRole('option', { name: /^Keine/ }).click()
  await dialog.getByLabel('Port').fill(String(SANDBOX.port))
  await dialog.getByLabel('Passwort').fill(SANDBOX_PASS)

  const result = dialog.getByTestId('mail-account-test-result')
  await dialog.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(result).toContainText(/Verbindung erfolgreich: \d+ Ordner gefunden/, {
    timeout: 20_000
  })

  // Nothing listens on a port that was just freed
  const closedPort = await new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
  await dialog.getByLabel('Port').fill(String(closedPort))
  await expect(result).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(result).toContainText('an diesem Port antwortet kein Mailserver', {
    timeout: 20_000
  })

  // A rejected password is reported and nothing is saved
  await dialog.getByLabel('Port').fill(String(SANDBOX.port))
  await dialog.getByLabel('Passwort').fill('wrong-password')
  await dialog.getByRole('button', { name: 'Speichern' }).click()
  await expect(result).toContainText('Anmeldung abgelehnt', { timeout: 20_000 })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(before)
})

test('unknown methods are refused before reaching the core', async () => {
  await expect(mail('close')).rejects.toThrow()
  await expect(mail('replayPendingOps')).rejects.toThrow()
})
