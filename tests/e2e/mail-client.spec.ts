// E2E: the mail client end to end (renderer → tRPC → main → utility process
// → mail core → IMAP) against the local Dovecot/Mailpit sandbox from the
// email prototype (docker compose, ports 10143/10144/1025). Skipped when the
// sandbox is not running. Never touches a real mailbox, nor testuser's: the suite
// logs in as its own sandbox user and seeds that mailbox itself.
import { test, expect } from '@playwright/test'
import { connect, createServer, type AddressInfo } from 'net'
import { readFileSync } from 'fs'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'
import {
  E2E_MAIL_PASS,
  E2E_MAIL_USER,
  removeSentTestMails,
  appendTestMail,
  seedMailSandbox
} from './helpers/mailSandbox'

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

type Account = { id: string; kind: string; email: string; host: string; port: number; user: string }
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

const SANDBOX_ACCOUNT = {
  kind: 'sandbox',
  host: SANDBOX.host,
  port: SANDBOX.port,
  security: 'none',
  user: SANDBOX_USER,
  email: SANDBOX_USER,
  password: SANDBOX_PASS
}

const READ_ONLY_ACCOUNT = {
  kind: 'production-readonly',
  host: SANDBOX.host,
  port: SANDBOX.ionosLikePort,
  security: 'none',
  user: SANDBOX_USER,
  email: SANDBOX_USER,
  password: SANDBOX_PASS
}

const listAccounts = (): Promise<Account[]> => trpc<Account[]>('query', 'mail.accounts.list')

/**
 * The sandbox account, saved on first use. Every test that needs an account calls this
 * instead of reading an id an earlier test may not have saved (card T3).
 */
async function ensureSandboxAccount(): Promise<string> {
  const existing = (await listAccounts()).find(
    (a) => a.kind === 'sandbox' && a.user === SANDBOX_USER
  )
  return existing?.id ?? (await saveAccount(SANDBOX_ACCOUNT)).id
}

/** The read-only account (IONOS-like profile), saved on first use. */
async function ensureReadOnlyAccount(): Promise<string> {
  const existing = (await listAccounts()).find(
    (a) => a.kind === 'production-readonly' && a.port === SANDBOX.ionosLikePort
  )
  return existing?.id ?? (await saveAccount(READ_ONLY_ACCOUNT)).id
}

test('a sandbox account is saved with an encrypted password', async () => {
  // This test proves a FRESH save, so it drops what an earlier test may have saved
  for (const account of await listAccounts()) {
    await trpc('mutation', 'mail.accounts.delete', { id: account.id })
  }
  const account = await saveAccount(SANDBOX_ACCOUNT)
  expect(account).not.toHaveProperty('password')

  const stored = readFileSync(join(userData, 'mail', 'accounts.json'), 'utf-8')
  expect(stored).not.toContain(SANDBOX_PASS)
  expect(JSON.parse(stored)[0].password.length).toBeGreaterThan(0)
})

test('the worker syncs folders and serves messages over IPC', async () => {
  const sandboxId = await ensureSandboxAccount()
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

/**
 * Waits until the account's INBOX exists with at least `minCount` messages. A freshly saved
 * account syncs in the background, so a test that runs alone must wait for that (card T3).
 */
async function waitForInbox(accountId: string, minCount = 1): Promise<Folder> {
  const folders = await waitFor(
    () => mail<Folder[]>('getFolders', accountId),
    (f) => f.some((x) => x.path === 'INBOX' && x.totalCount >= minCount)
  )
  return folders.find((f) => f.path === 'INBOX')!
}

/** Opens the mail page on the given account (the first one when omitted). */
const openMailPage = async (accountId?: string) => {
  await h.page.goto(`${h.page.url().split('#')[0]}#/mail`)
  // Accounts saved over raw IPC above are not in the page's cache yet
  await h.page.reload()
  await expect(h.page.getByRole('heading', { name: 'E-Mail', level: 1 })).toBeVisible()
  if (!accountId) return
  const accounts = await listAccounts()
  if (accounts.length < 2) return
  const index = accounts.findIndex((a) => a.id === accountId)
  await h.page.getByRole('combobox', { name: 'Postfach' }).click()
  await h.page.getByRole('option').nth(index).click()
}

test('the mail page shows folders, messages and a sandboxed reader', async () => {
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  await openMailPage(sandboxId)
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
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  await openMailPage(sandboxId)
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
  await openMailPage(sandboxId)
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
  const sandboxId = await ensureSandboxAccount()
  const sidebar = page.getByRole('navigation', { name: 'Hauptnavigation' })
  const expand = page.getByRole('button', { name: 'Seitenleiste ausklappen' })
  const collapse = page.getByRole('button', { name: 'Seitenleiste einklappen' })
  const sidebarWidth = async () => Math.round((await sidebar.boundingBox())!.width)

  await openMailPage(sandboxId)
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
  await openMailPage(sandboxId)
  await expect(expand).toBeVisible()
})

test('a mail dragged onto a folder is moved there', async () => {
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const count = async (folderId: string) =>
    (await mail<Folder[]>('getFolders', sandboxId)).find((f) => f.id === folderId)!.totalCount
  const folders = await mail<Folder[]>('getFolders', sandboxId)
  const inbox = folders.find((f) => f.path === 'INBOX')!
  // Its own top-level folder: a shared one collects mail from other suites and
  // makes the counts below depend on what ran before
  const targetPath = `E2E-Drag-${Date.now()}`
  await mail('createFolder', null, targetPath, sandboxId)
  const target = (await waitFor(
    async () => mail<Folder[]>('getFolders', sandboxId),
    (list) => list.some((f) => f.path === targetPath),
    30_000
  )).find((f) => f.path === targetPath)!
  // The inbox may still be downloading and growing, so the mail itself is followed;
  // a move keeps its row id
  // The folder list's totalCount can lag behind the store, so both sides of the
  // assertions below are live counts
  const targetBefore = await count(target!.id)
  const folderOf = async (id: number) =>
    (await mail<{ folderId: string }>('getMessage', id, sandboxId)).folderId

  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
  await openMailPage(sandboxId)
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
    // The folder was empty before the move and is again after the undo
    await mail('deleteFolder', targetPath, sandboxId).catch(() => undefined)
  }
})

test('several mails are selected and handled at once', async () => {
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  // Three rows are clicked below, so the inbox must have synced that far
  await waitForInbox(sandboxId, 3)
  const folders = await mail<Folder[]>('getFolders', sandboxId)
  const inbox = folders.find((f) => f.path === 'INBOX')!
  const trash = folders.find((f) => f.specialUse === '\\Trash')
  const target = folders.find((f) => f.path !== 'INBOX' && !f.specialUse)
  test.skip(!trash || !target, 'the sandbox has no Trash or plain top-level folder')
  const started = new Date().toISOString()

  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
  await openMailPage(sandboxId)
  const list = page.getByRole('listbox', { name: 'Nachrichten' })
  const rows = list.getByRole('option')
  await expect(rows.nth(2)).toBeVisible({ timeout: 30_000 })
  const selected = list.getByRole('option', { selected: true })
  const pane = page.getByRole('region', { name: 'Auswahl' })
  const ids = await Promise.all(
    [0, 1, 2].map(async (i) => Number(await rows.nth(i).getAttribute('data-message-id')))
  )
  type State = { folderId: string; uid: number; isRead: boolean; isFlagged: boolean }
  const state = (id: number) => mail<State>('getMessage', id, sandboxId)
  // How the mails were, to put them back exactly so
  const before = await Promise.all(ids.map(state))
  // Their inbox UIDs; a mail moved back gets a new one
  let inboxUids = before.map((s) => s.uid)

  type Op = {
    id: string
    kind: string
    state: string
    uid: number | null
    folderPath: string | null
    targetFolderPath: string | null
    createdAt: string
  }
  // Undoes this test's move of a mail that is not back in the inbox
  const putBack = async (i: number) => {
    const now = await state(ids[i]).catch(() => null)
    if (!now || now.folderId === inbox.id) return
    const path = folders.find((f) => f.id === now.folderId)?.path
    const op = (await mail<Op[]>('listOps', sandboxId)).find(
      (o) =>
        (o.kind === 'move' || o.kind === 'move_batch') &&
        o.state === 'done' &&
        o.createdAt >= started &&
        o.uid === inboxUids[i] &&
        o.folderPath === 'INBOX' &&
        o.targetFolderPath === path
    )
    if (op) await mail('undoOp', op.id, sandboxId)
  }

  try {
    // Ctrl+click adds a mail, the checkboxes too; several show the bulk pane
    await rows.nth(0).click()
    await rows.nth(1).click({ modifiers: ['Control'] })
    await expect(selected).toHaveCount(2)
    await expect(pane.getByRole('heading', { name: '2 E-Mails ausgewählt' })).toBeVisible()
    await rows.nth(2).getByRole('checkbox', { name: 'Auswählen' }).check()
    await expect(selected).toHaveCount(3)
    await rows.nth(1).click({ modifiers: ['Control'] })
    await expect(selected).toHaveCount(2)

    // Shift+click selects the range from the last plain click, Shift+arrows change it
    await rows.nth(0).click()
    await expect(page.getByRole('article', { name: 'E-Mail' })).toBeVisible()
    await rows.nth(2).click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(3)
    await list.press('Shift+ArrowUp')
    await expect(selected).toHaveCount(2)
    await list.press('Escape')
    await expect(selected).toHaveCount(1)
    await list.press('Control+a')
    await expect(selected).toHaveCount(await rows.count())
    await expect(pane.getByRole('heading', { name: /^\d+ E-Mails ausgewählt$/ })).toBeVisible()

    // Flags and read state for all of them
    await rows.nth(0).click()
    await rows.nth(2).click({ modifiers: ['Shift'] })
    const flag = pane.getByRole('button', { name: /^Markier/ })
    const flagTo = (await flag.textContent())?.trim() === 'Markieren'
    await flag.click()
    await expect
      .poll(async () => (await Promise.all(ids.map(state))).every((s) => s.isFlagged === flagTo))
      .toBe(true)
    const read = pane.getByRole('button', { name: /^Als (un)?gelesen markieren$/ })
    const readTo = (await read.textContent())?.trim() === 'Als gelesen markieren'
    await read.click()
    await expect
      .poll(async () => (await Promise.all(ids.map(state))).every((s) => s.isRead === readTo))
      .toBe(true)

    // Right-click: the menu acts on the selection; outside it, on the row alone
    await rows.nth(1).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /In den Papierkorb/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'In eigenem Fenster öffnen' })).toHaveCount(0)
    // The open menu hides the list from the accessibility tree; check it once closed
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(selected).toHaveCount(3)

    // Delete moves all selected mails to Trash, one undo brings them all back
    await rows.nth(0).click()
    await rows.nth(1).click({ modifiers: ['Shift'] })
    await list.press('Delete')
    const deleted = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: '2 E-Mails in den Papierkorb verschoben' })
    await expect(deleted).toBeVisible({ timeout: 30_000 })
    expect((await state(ids[0])).folderId).toBe(trash!.id)
    expect((await state(ids[1])).folderId).toBe(trash!.id)
    await deleted.getByRole('button', { name: 'Rückgängig' }).click()
    await expect
      .poll(async () => [(await state(ids[0])).folderId, (await state(ids[1])).folderId], {
        timeout: 30_000
      })
      .toEqual([inbox.id, inbox.id])

    // Dragging one of the selected mails takes the others along
    inboxUids = (await Promise.all(ids.map(state))).map((s) => s.uid)
    const first = page.locator(`[data-message-id="${ids[0]}"]`)
    await expect(first).toBeVisible({ timeout: 30_000 })
    await first.click()
    await page.locator(`[data-message-id="${ids[1]}"]`).click({ modifiers: ['Control'] })
    await expect(selected).toHaveCount(2)
    await first.dragTo(
      page.getByRole('list', { name: 'Ordner' }).locator(`button[title="${target!.path}"]`)
    )
    const moved = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: /^2 E-Mails nach „.+“ verschoben/ })
    await expect(moved).toBeVisible({ timeout: 30_000 })
    expect((await state(ids[0])).folderId).toBe(target!.id)
    expect((await state(ids[1])).folderId).toBe(target!.id)
    await moved.getByRole('button', { name: 'Rückgängig' }).click()
    await expect
      .poll(async () => [(await state(ids[0])).folderId, (await state(ids[1])).folderId], {
        timeout: 30_000
      })
      .toEqual([inbox.id, inbox.id])
  } finally {
    // The sandbox stays as it was, also when a check above failed
    for (let i = 0; i < ids.length; i++) await putBack(i)
    for (let i = 0; i < ids.length; i++) {
      await mail('markRead', [ids[i]], before[i].isRead, sandboxId)
      await mail('markFlagged', [ids[i]], before[i].isFlagged, sandboxId)
    }
  }
})

test('the mail shortcuts work from the list and leave typing alone', async () => {
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const list = page.getByRole('listbox', { name: 'Nachrichten' })
  const rows = list.getByRole('option')
  const state = (id: number) => mail<{ isRead: boolean }>('getMessage', id, sandboxId)

  await openMailPage(sandboxId)
  await expect(rows.first()).toBeVisible({ timeout: 30_000 })
  const id = Number(await rows.first().getAttribute('data-message-id'))
  const before = (await state(id)).isRead

  try {
    await rows.first().click()
    // Ctrl+U marks unread, Ctrl+Q marks read - the Outlook keys (B3)
    await list.press('Control+u')
    await expect.poll(async () => (await state(id)).isRead, { timeout: 30_000 }).toBe(false)
    await list.press('Control+q')
    await expect.poll(async () => (await state(id)).isRead, { timeout: 30_000 }).toBe(true)

    // While typing in the search field, a shortcut must not fire
    const search = page.getByRole('searchbox', { name: 'E-Mails durchsuchen' })
    await search.click()
    await search.press('Control+u')
    await page.waitForTimeout(300)
    expect((await state(id)).isRead).toBe(true)
  } finally {
    await mail('markRead', [id], before, sandboxId)
  }
})

const MAILPIT = { smtpPort: 1025, apiPort: 8025 }
const COMPOSE_TAG = 'e2e-compose-'

test('a mail written in the editor is saved as a draft and sent', async () => {
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const folders = await mail<Folder[]>('getFolders', sandboxId)
  const drafts = folders.find((f) => f.specialUse === '\\Drafts')
  const sent = folders.find((f) => f.specialUse === '\\Sent')
  test.skip(!drafts || !sent, 'the sandbox has no Drafts or Sent folder')
  test.skip(!(await reachable(MAILPIT.smtpPort)), 'Mailpit is not running')
  const count = async (folderId: string) =>
    (await mail<Folder[]>('getFolders', sandboxId)).find((f) => f.id === folderId)!.totalCount
  const draftsBefore = await count(drafts!.id)
  const sentBefore = await count(sent!.id)
  // Mailpit is shared with other sandbox users; this mail is found by its own subject
  const tag = `${COMPOSE_TAG}${Date.now()}`
  const delivered = async () => {
    const query = encodeURIComponent(`subject:${tag}`)
    const res = await fetch(
      `http://${SANDBOX.host}:${MAILPIT.apiPort}/api/v1/search?query=${query}`
    )
    return ((await res.json()) as { messages_count: number }).messages_count
  }

  try {
    await openMailPage(sandboxId)
    await page.getByRole('button', { name: 'Neue E-Mail' }).click()
    const editor = page.getByRole('form', { name: 'E-Mail verfassen' })
    // Leaving the field turns the typed address into a recipient
    await editor.getByRole('textbox', { name: 'An' }).fill('empfaenger@example.test')
    await editor.getByRole('textbox', { name: 'Betreff' }).fill(tag)
    await editor.getByRole('textbox', { name: 'Text' }).fill('Hallo aus dem E2E-Test')
    await expect(editor.getByText('empfaenger@example.test')).toBeVisible()

    await editor.getByRole('button', { name: 'Entwurf speichern' }).click()
    await expect(editor.getByText(/^Gespeichert/)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => count(drafts!.id), { timeout: 30_000 }).toBe(draftsBefore + 1)

    await editor.getByRole('button', { name: 'Senden', exact: true }).click()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Gesendet' })).toBeVisible({
      timeout: 30_000
    })
    await expect(editor).toHaveCount(0)
    await expect.poll(delivered, { timeout: 30_000 }).toBe(1)
    // Filed in Sent, and the draft it was written in is gone
    await expect.poll(() => count(sent!.id), { timeout: 30_000 }).toBe(sentBefore + 1)
    await expect.poll(() => count(drafts!.id), { timeout: 30_000 }).toBe(draftsBefore)
  } finally {
    // The sandbox stays as it was: this mail (and any an earlier, failed run left) goes again
    await removeSentTestMails(SANDBOX.host, SANDBOX.port, MAILPIT.apiPort, COMPOSE_TAG)
  }
})

test('a double-clicked mail opens in its own window and is answered there', async () => {
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const folders = await mail<Folder[]>('getFolders', sandboxId)
  const drafts = folders.find((f) => f.specialUse === '\\Drafts')
  test.skip(!drafts, 'the sandbox has no Drafts folder')
  // The cleanup below also looks in Mailpit
  test.skip(!(await reachable(MAILPIT.smtpPort)), 'Mailpit is not running')
  const count = async (folderId: string) =>
    (await mail<Folder[]>('getFolders', sandboxId)).find((f) => f.id === folderId)!.totalCount
  const windows = () => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const draftsBefore = await count(drafts!.id)
  const tag = `${COMPOSE_TAG}${Date.now()}`

  await openMailPage(sandboxId)
  const row = page.getByRole('listbox', { name: 'Nachrichten' }).getByRole('option').first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  const id = Number(await row.getAttribute('data-message-id'))
  const [popup] = await Promise.all([h.app.waitForEvent('window'), row.dblclick()])
  try {
    const reader = popup.getByRole('article', { name: 'E-Mail' })
    const heading = reader.getByRole('heading', { level: 2 })
    await expect(heading).toBeVisible({ timeout: 30_000 })
    const subject = (await heading.textContent()) ?? ''
    if (subject !== '(Kein Betreff)') await expect(popup).toHaveTitle(subject)
    // Without the app chrome
    await expect(popup.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0)
    // Opening it again brings that window forward instead of a second one
    expect(await windows()).toBe(2)
    await page.evaluate(([account, message]) => window.api.openMailWindow(account, message), [
      sandboxId,
      id
    ] as const)
    expect(await windows()).toBe(2)

    // The answer is written in this window; an untouched one goes back to the mail
    const editor = popup.getByRole('form', { name: 'E-Mail verfassen' })
    await reader.getByRole('button', { name: 'Antworten', exact: true }).click()
    await expect(editor.getByRole('textbox', { name: 'Betreff' })).toHaveValue(/^(AW|Re):/i)
    await editor.getByRole('button', { name: 'Verwerfen' }).click()
    await expect(editor).toHaveCount(0)
    await expect(heading).toBeVisible()

    // Closing the window with an unsaved answer keeps it as a draft
    await reader.getByRole('button', { name: 'Antworten', exact: true }).click()
    await editor.getByRole('textbox', { name: 'Betreff' }).fill(tag)
    await editor.getByRole('textbox', { name: 'Text' }).fill('Antwort aus dem E2E-Test')
    const closed = popup.waitForEvent('close')
    await popup.close({ runBeforeUnload: true })
    await closed
    await expect.poll(() => count(drafts!.id), { timeout: 30_000 }).toBe(draftsBefore + 1)
    expect(await windows()).toBe(1)
  } finally {
    if (!popup.isClosed()) await popup.close()
    // The sandbox stays as it was: the draft goes again
    await removeSentTestMails(SANDBOX.host, SANDBOX.port, MAILPIT.apiPort, COMPOSE_TAG)
  }
})

test('a read-only account refuses writes', async () => {
  test.skip(!(await reachable(SANDBOX.ionosLikePort)), 'IONOS-like sandbox is not running')
  // Plain text is accepted for a production account on loopback only
  const readOnlyId = await ensureReadOnlyAccount()
  const folders = await waitFor(
    () => mail<Folder[]>('getFolders', readOnlyId),
    (f) => f.some((x) => x.path === 'INBOX' && x.totalCount > 0)
  )
  const inbox = folders.find((f) => f.path === 'INBOX')!
  const list = await waitFor(
    () => mail<{ id: number }[]>('listMessages', inbox.id, { offset: 0, limit: 1 }, readOnlyId),
    (l) => l.length > 0
  )
  await expect(mail('markRead', [list[0].id], true, readOnlyId)).rejects.toThrow(
    /read-only|guard|not allowed|refus/i
  )
  await expect(mail('deleteToTrash', [list[0].id], readOnlyId)).rejects.toThrow()
})

test('the mail page offers no writes for a read-only account', async () => {
  test.skip(!(await reachable(SANDBOX.ionosLikePort)), 'IONOS-like sandbox is not running')
  const { page } = h
  const readOnlyId = await ensureReadOnlyAccount()
  const inbox = await waitForInbox(readOnlyId)
  await openMailPage(readOnlyId)
  await expect(page.getByRole('note').filter({ hasText: 'Nur lesen' })).toBeVisible()

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
  const accounts = await listAccounts()
  const hasReadOnly = accounts.some((a) => a.kind === 'production-readonly')
  await page.goto(`${page.url().split('#')[0]}#/settings?tab=email`)
  const list = page.getByRole('list', { name: 'E-Mail-Konten' })
  await expect(list.getByRole('listitem')).toHaveCount(accounts.length)
  if (hasReadOnly) await expect(list.getByText('Nur lesen')).toBeVisible()
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

// B5: a mail the test creates itself goes to Trash and is then deleted for good.
// Nothing a seeded test needs is touched: the mail is sent with its own subject tag.
const EXPUNGE_TAG = 'e2e-expunge-'

test('a mail in Trash is deleted permanently and the counts drop', async () => {
  // A first sync of the sandbox mailbox can take a while; the default 60s is not enough
  test.setTimeout(180_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const folders = await mail<Folder[]>('getFolders', sandboxId)
  const trash = folders.find((f) => f.specialUse === '\\Trash')
  test.skip(!trash, 'the sandbox has no Trash folder')
  test.skip(!(await reachable(MAILPIT.smtpPort)), 'Mailpit is not running')

  const count = async (folderId: string) =>
    (await mail<Folder[]>('getFolders', sandboxId)).find((f) => f.id === folderId)!.totalCount
  const tag = `${EXPUNGE_TAG}${Date.now()}`
  // A wide window shows the folder tree; the small one only has the folder picker
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))

  try {
    // 1. A mail this test appends itself - never one a seeded test needs
    await appendTestMail(SANDBOX.host, SANDBOX.port, tag)
    await mail('triggerSync', true, sandboxId)

    // 2. It is delivered and synced into INBOX; then it goes to Trash
    const mine = await waitFor(
      async () => {
        const inbox = (await mail<Folder[]>('getFolders', sandboxId)).find(
          (f) => f.path === 'INBOX'
        )!
        const items = await mail<{ id: number; subject: string }[]>(
          'listMessages',
          inbox.id,
          { offset: 0, limit: 50 },
          sandboxId
        )
        return items.find((m) => m.subject === tag) ?? null
      },
      (m) => m !== null,
      120_000
    )
    await mail('deleteToTrash', [mine!.id], sandboxId)
    await expect.poll(() => count(trash!.id), { timeout: 30_000 }).toBeGreaterThan(0)
    const trashBefore = await count(trash!.id)

    // 3. In the UI: open Trash, right-click the mail, delete it permanently
    await openMailPage(sandboxId)
    await page.getByRole('button', { name: /^Papierkorb/ }).click()
    const list = page.getByRole('listbox', { name: 'Nachrichten' })
    const row = list.getByRole('option').filter({ hasText: tag })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Endgültig löschen' }).click()

    // The confirmation names the consequence
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Das kann nicht rückgängig gemacht werden.')
    await dialog.getByRole('button', { name: 'Endgültig löschen' }).click()

    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'Endgültig gelöscht' })
    ).toBeVisible({ timeout: 30_000 })
    // 4. The folder count drops by exactly this one mail
    await expect.poll(() => count(trash!.id), { timeout: 30_000 }).toBe(trashBefore - 1)
    await expect(list.getByRole('option').filter({ hasText: tag })).toHaveCount(0)
  } finally {
    await removeSentTestMails(SANDBOX.host, SANDBOX.port, MAILPIT.apiPort, EXPUNGE_TAG)
  }
})

// B6: an attachment is written by the main process, not by the renderer. The test
// appends a mail with its own attachment and checks the file that lands on disk.
const ATTACH_TAG = 'e2e-attach-'

test('an attachment opens from the reader and lands in the temp folder', async () => {
  test.setTimeout(180_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const tag = `${ATTACH_TAG}${Date.now()}`
  const fileName = 'notiz.txt'
  const body = 'Anhang aus dem E2E-Test'

  try {
    // 1. A mail with one attachment, appended by the test itself
    await appendTestMail(SANDBOX.host, SANDBOX.port, tag, {
      filename: fileName,
      contentType: 'text/plain',
      body
    })
    await mail('triggerSync', true, sandboxId)
    const mine = await waitFor(
      async () => {
        const inbox = (await mail<Folder[]>('getFolders', sandboxId)).find(
          (f) => f.path === 'INBOX'
        )!
        const items = await mail<{ id: number; subject: string }[]>(
          'listMessages',
          inbox.id,
          { offset: 0, limit: 50 },
          sandboxId
        )
        return items.find((m) => m.subject === tag) ?? null
      },
      (m) => m !== null,
      120_000
    )
    const detail = await mail<{ attachments: { partId: string; filename: string }[] }>(
      'getMessage',
      mine!.id,
      sandboxId
    )
    const part = detail.attachments.find((a) => a.filename === fileName)
    expect(part, 'the attachment is parsed').toBeTruthy()

    // 2. The main process opens it; the renderer only names the attachment
    const opened = await page.evaluate(
      async ({ accountId, messageId, partId, filename }) =>
        new Promise<{ opened: boolean; name: string; executable: boolean }>((resolve, reject) => {
          const id = Math.floor(Math.random() * 1e9)
          const w = window as unknown as {
            electronTRPC: {
              onMessage: (
                cb: (m: { id: number; result?: { data?: unknown }; error?: unknown }) => void
              ) => void
              sendMessage: (m: unknown) => void
            }
          }
          w.electronTRPC.onMessage((m) => {
            if (m.id !== id) return
            if (m.error) reject(new Error(JSON.stringify(m.error)))
            else resolve(m.result?.data as { opened: boolean; name: string; executable: boolean })
          })
          w.electronTRPC.sendMessage({
            method: 'request',
            operation: {
              id,
              type: 'mutation',
              path: 'mail.attachments.open',
              input: { accountId, messageId, partId, filename },
              context: {}
            }
          })
        }),
      { accountId: sandboxId, messageId: mine!.id, partId: part!.partId, filename: fileName }
    )
    expect(opened.opened).toBe(true)
    expect(opened.executable).toBe(false)
    // The name the main process used is sanitized, never the raw one
    expect(opened.name).toBe(fileName)

    // 3. The file exists in the temp folder and has the mail's bytes
    const tempDir = await h.app.evaluate(({ app }) => app.getPath('temp'))
    const written = join(tempDir, 'bookingum-mail')
    const found = await readdir(written, { recursive: true })
    expect(found.some((f) => String(f).endsWith(fileName))).toBe(true)
  } finally {
    await removeSentTestMails(SANDBOX.host, SANDBOX.port, MAILPIT.apiPort, ATTACH_TAG)
  }
})

// C6: the search palette shows mail hits next to the app's own records, and a click
// opens the mail window. The mail is one this test appends itself.
const PALETTE_TAG = 'e2e-palette-'

test('the search palette finds mails and opens one in its window', async () => {
  test.setTimeout(180_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const tag = `${PALETTE_TAG}${Date.now()}`

  try {
    await appendTestMail(SANDBOX.host, SANDBOX.port, tag)
    await mail('triggerSync', true, sandboxId)
    await waitFor(
      async () => {
        const inbox = (await mail<Folder[]>('getFolders', sandboxId)).find(
          (f) => f.path === 'INBOX'
        )!
        const items = await mail<{ subject: string }[]>(
          'listMessages',
          inbox.id,
          { offset: 0, limit: 50 },
          sandboxId
        )
        return items.some((m) => m.subject === tag)
      },
      (ok) => ok,
      120_000
    )

    // The palette finds it by subject, in its own group
    await page.goto(`${page.url().split('#')[0]}#/mail`)
    await page.getByRole('button', { name: 'Alles suchen (Ctrl+K)' }).click()
    await page.getByPlaceholder('Seiten, Einträge oder Aktionen suchen...').fill(tag)
    const group = page.getByRole('group', { name: 'E-Mails' })
    await expect(group).toBeVisible({ timeout: 30_000 })
    const hit = group.getByRole('option').filter({ hasText: tag })
    await expect(hit).toBeVisible()

    // A click opens the mail in its own window
    const opened = h.app.waitForEvent('window', { timeout: 30_000 })
    await hit.click()
    const mailWindow = await opened
    await expect(mailWindow.getByRole('heading', { name: tag, level: 2 })).toBeVisible({
      timeout: 30_000
    })
    await mailWindow.close()
  } finally {
    await removeSentTestMails(SANDBOX.host, SANDBOX.port, MAILPIT.apiPort, PALETTE_TAG)
  }
})

// B7: an attachment added in the editor is sent and arrives as one attachment.
// Count and size only - Mailpit is shared, so the mail is found by its own subject.
const ATTACH_COMPOSE_TAG = 'e2e-compose-attach-'

test('a mail written with an attachment arrives with it', async () => {
  test.setTimeout(180_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const folders = await mail<Folder[]>('getFolders', sandboxId)
  const sent = folders.find((f) => f.specialUse === '\\Sent')
  test.skip(!sent, 'the sandbox has no Sent folder')
  test.skip(!(await reachable(MAILPIT.smtpPort)), 'Mailpit is not running')

  const tag = `${ATTACH_COMPOSE_TAG}${Date.now()}`
  const body = 'Anhang aus dem E2E-Test'
  // The bytes Mailpit must report back
  const payload = 'Dies ist der Anhang.'
  const payloadBytes = Buffer.byteLength(payload)

  try {
    await openMailPage(sandboxId)
    await page.getByRole('button', { name: 'Neue E-Mail' }).click()
    const editor = page.getByRole('form', { name: 'E-Mail verfassen' })
    await editor.getByRole('textbox', { name: 'An' }).fill('empfaenger@example.test')
    await editor.getByRole('textbox', { name: 'Betreff' }).fill(tag)
    await editor.getByRole('textbox', { name: 'Text' }).fill(body)

    // Attach a small generated file through the editor's file input
    await editor.locator('input[type="file"]').setInputFiles({
      name: 'notiz.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(payload)
    })
    // The chip appears with the file name
    await expect(editor.getByText('notiz.txt')).toBeVisible({ timeout: 15_000 })

    await editor.getByRole('button', { name: 'Senden', exact: true }).click()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Gesendet' })).toBeVisible({
      timeout: 30_000
    })

    // Mailpit reports exactly one attachment of that size
    const found = await waitFor(
      async () => {
        const query = encodeURIComponent(`subject:${tag}`)
        const res = await fetch(
          `http://${SANDBOX.host}:${MAILPIT.apiPort}/api/v1/search?query=${query}`
        )
        const data = (await res.json()) as { messages?: { ID: string }[] }
        return data.messages?.[0]?.ID ?? null
      },
      (id) => id !== null,
      60_000
    )
    const detail = (await (
      await fetch(`http://${SANDBOX.host}:${MAILPIT.apiPort}/api/v1/message/${found}`)
    ).json()) as { Attachments?: { FileName: string; Size: number }[] }
    expect(detail.Attachments).toHaveLength(1)
    expect(detail.Attachments![0].FileName).toBe('notiz.txt')
    expect(detail.Attachments![0].Size).toBe(payloadBytes)
  } finally {
    await removeSentTestMails(SANDBOX.host, SANDBOX.port, MAILPIT.apiPort, ATTACH_COMPOSE_TAG)
  }
})

// C3: a mail from a person's own address shows up in that person's E-Mails tab.
// The mail is one this test appends itself; only the row count is checked.
const LINK_TAG = 'e2e-link-'
const LINKED_PERSON = { firstName: 'John', lastName: 'Rockstar' }
const LINKED_ADDRESS = 'john.rockstar@music.example.test'

test("a mail from a person's address appears in their E-Mails tab", async () => {
  test.setTimeout(240_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  const tag = `${LINK_TAG}${Date.now()}`

  try {
    // 1. A mail from the address the seeded person owns
    await appendTestMail(SANDBOX.host, SANDBOX.port, tag, undefined, LINKED_ADDRESS)
    await mail('triggerSync', true, sandboxId)

    // 2. The person's page shows the mail in its E-Mails tab. The linker runs
    // after the folder sync, so the panel is polled rather than slept on.
    await page.getByRole('button', { name: 'Alles suchen (Ctrl+K)' }).click()
    await page
      .getByPlaceholder('Seiten, Einträge oder Aktionen suchen...')
      .fill(LINKED_PERSON.firstName)
    await page
      .getByRole('option', {
        name: new RegExp(`${LINKED_PERSON.firstName} ${LINKED_PERSON.lastName}`)
      })
      .first()
      .click()
    await expect(
      page.getByRole('heading', { name: `${LINKED_PERSON.firstName} ${LINKED_PERSON.lastName}` })
    ).toBeVisible()
    await page.getByRole('tab', { name: 'E-Mails' }).click()
    // The linker runs after the folder sync and works through the mailbox in
    // batches, so the row is awaited rather than slept on.
    const panel = page.getByRole('list', { name: 'E-Mails' })
    // The row for this test's own mail: the seeded person may have other mails
    const row = panel.getByRole('listitem').filter({ hasText: tag })
    await expect(row).toHaveCount(1, { timeout: 60_000 })
    // The link source is shown small, and it is an automatic one
    await expect(row).toContainText('automatisch')
  } finally {
    await removeSentTestMails(SANDBOX.host, SANDBOX.port, MAILPIT.apiPort, LINK_TAG)
  }
})

// B1: a folder is created, renamed and deleted in the UI, and the sandbox is left
// as it was found.
const FOLDER_PREFIX = 'E2E-Ordner-'

test('a folder is created, renamed and deleted from the tree', async () => {
  test.setTimeout(180_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
  const name = `${FOLDER_PREFIX}${Date.now()}`
  const renamed = `${name}-neu`
  const tree = page.getByRole('list', { name: 'Ordner' })

  await openMailPage(sandboxId)
  try {
    // 1. Create a top-level folder from the tree's own menu
    // Two buttons carry the name: the expand chevron and the folder itself
    await tree.getByRole('button', { name: /^Posteingang/ }).last().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Neuer Ordner…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(tree.getByRole('button', { name })).toBeVisible({ timeout: 30_000 })

    // 2. Rename it through its own menu
    await tree.getByRole('button', { name }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Umbenennen…' }).click()
    const renameDialog = page.getByRole('dialog')
    await expect(renameDialog).toBeVisible()
    // The current name is offered as the starting point
    await expect(renameDialog.getByLabel('Name')).toHaveValue(name)
    await renameDialog.getByLabel('Name').fill(renamed)
    await renameDialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(tree.getByRole('button', { name: renamed })).toBeVisible({ timeout: 30_000 })
    await expect(tree.getByRole('button', { name: new RegExp(`^${name}$`) })).toHaveCount(0)

    // 3. Delete it again, confirmed
    await tree.getByRole('button', { name: renamed }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Löschen…' }).click()
    const deleteDialog = page.getByRole('dialog')
    await expect(deleteDialog).toContainText('endgültig gelöscht')
    await deleteDialog.getByRole('button', { name: 'Löschen' }).click()
    await expect(tree.getByRole('button', { name: renamed })).toHaveCount(0, { timeout: 30_000 })
  } finally {
    // The sandbox is left as it was found, also when a step failed
    const { ImapFlow } = await import('imapflow')
    const client = new ImapFlow({
      host: SANDBOX.host,
      port: SANDBOX.port,
      secure: false,
      auth: { user: SANDBOX_USER, pass: SANDBOX_PASS },
      logger: false
    })
    await client.connect()
    try {
      const paths = (await client.list())
        .map((f) => f.path)
        .filter((p) => p.startsWith(FOLDER_PREFIX))
      for (const p of paths) await client.mailboxDelete(p).catch(() => undefined)
    } finally {
      await client.logout().catch(() => client.close())
    }
  }
})


// C1: "bookingum" as the mail program sends an invoice mail from bookingum's own
// editor. The invoice counts as emailed only after that send, and Mailpit sees one
// mail with one PDF attachment (count and size only).
const C1_TAG = 'e2e-c1-invoice-'

test("an invoice mail is sent from bookingum's own editor", async () => {
  test.setTimeout(240_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  test.skip(!(await reachable(MAILPIT.smtpPort)), 'Mailpit is not running')
  const subject = `${C1_TAG}${Date.now()}`
  const base = () => page.url().split('#')[0]

  try {
    // 1. Choose bookingum as the mail program and prove the setting took
    await page.goto(`${base()}#/settings?tab=email`)
    await page.locator('#settings-mail-program').click()
    await page.getByRole('option', { name: /bookingum \(eigenes E-Mail-Konto\)/ }).click()
    await expect(page.locator('#settings-mail-program')).toContainText(/bookingum/, {
      timeout: 15_000
    })
    await expect
      .poll(
        async () =>
          (await trpc<{ mailProgram: string }>('query', 'settings.get')).mailProgram,
        { timeout: 15_000 }
      )
      .toBe('bookingum')

    // 2. Open the invoice's print page and send it through the own editor
    await page.goto(`${base()}#/invoices`)
    await page
      .locator('tr')
      .filter({ has: page.getByRole('cell', { name: '#1040', exact: true }) })
      .getByRole('button', { name: 'Drucken / Als PDF speichern' })
      .click()
    await page.waitForURL(/invoices\/\d+\/print/)
    await page.waitForSelector('canvas[data-page="1"]', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Per E-Mail senden' }).click()

    // The prepared draft opens in its own window
    const editorWindow = await h.app.waitForEvent('window', { timeout: 60_000 })
    await editorWindow.waitForLoadState()
    await editorWindow.waitForLoadState()
    const editor = editorWindow.getByRole('form', { name: 'E-Mail verfassen' })
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await editor.getByRole('textbox', { name: 'Betreff' }).fill(subject)

    // The editor closes itself once the mail is out - that is the completion signal
    const closed = editorWindow.waitForEvent('close', { timeout: 60_000 })
    await editor.getByRole('button', { name: 'Senden', exact: true }).click()
    await closed

    // 3. Mailpit has exactly one mail with one PDF attachment
    const found = await waitFor(
      async () => {
        const query = encodeURIComponent(`subject:${subject}`)
        const res = await fetch(
          `http://${SANDBOX.host}:${MAILPIT.apiPort}/api/v1/search?query=${query}`
        )
        const data = (await res.json()) as { messages?: { ID: string }[] }
        return data.messages?.[0]?.ID ?? null
      },
      (id) => id !== null,
      60_000
    )
    const detail = (await (
      await fetch(`http://${SANDBOX.host}:${MAILPIT.apiPort}/api/v1/message/${found}`)
    ).json()) as { Attachments?: { FileName: string; Size: number }[] }
    expect(detail.Attachments).toHaveLength(1)
    expect(detail.Attachments![0].FileName).toMatch(/\.pdf$/)
    expect(detail.Attachments![0].Size).toBeGreaterThan(1000)

    // 4. The invoice counts as emailed, only after that send
    await page.goto(`${base()}#/invoices`)
    const row = page
      .locator('tr')
      .filter({ has: page.getByRole('cell', { name: '#1040', exact: true }) })
    await expect(
      row.getByRole('img', { name: /^E-Mail erstellt am \d\d\.\d\d\.\d{4}/ })
    ).toBeVisible({ timeout: 30_000 })

    // C4: the sent mail is listed on the invoice, and no reply has arrived
    const invoiceId = (
      await trpc<{ items: { id: number; invoiceNumber: number }[] }>('query', 'invoice.getAllPaginated', {
        page: 1,
        pageSize: 100,
        search: '1040'
      })
    ).items.find((i) => i.invoiceNumber === 1040)?.id
    await page.goto(`${base()}#/invoices/${invoiceId}`)
    const mails = page.getByRole('list', { name: 'E-Mails zur Rechnung' })
    await expect(mails.getByRole('listitem')).toHaveCount(1, { timeout: 30_000 })
    await expect(mails).toContainText('E-Mail erstellt')
    await expect(mails).toContainText('contact@soundwaverecords.example.test')
    await expect(page.getByText('Antwort erhalten')).toHaveCount(0)
  } finally {
    // back to files: later tests must not send anything
    await page.goto(`${base()}#/settings?tab=email`)
    await page.locator('#settings-mail-program').click()
    await page.getByRole('option', { name: /Nur Dateien speichern/ }).click()
    await removeSentTestMails(SANDBOX.host, SANDBOX.port, MAILPIT.apiPort, C1_TAG)
  }
})


test('C5: an attachment of a mail becomes a document', async () => {
  test.setTimeout(120_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)

  // A mail with a PDF attachment, sent to this mailbox so the test owns it
  const accounts = await listAccounts()
  const me = accounts.find((a) => a.id === sandboxId)
  test.skip(!me, 'the sandbox account is missing')
  const attachmentTag = `${C1_TAG}anhang-${Date.now()}`
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8')
  await mail('sendMail', {
    to: [{ name: 'Ich', email: me!.email }],
    cc: [],
    bcc: [],
    subject: attachmentTag,
    bodyText: 'Anbei die Datei.',
    bodyHtml: null,
    inReplyTo: null,
    references: [],
    attachments: [
      {
        filename: 'Angebot.pdf',
        contentType: 'application/pdf',
        base64: pdf.toString('base64')
      }
    ]
  }, null, sandboxId)

  // It has to arrive through IMAP before the UI can show it
  const found = await waitFor(
    () => mail<{ total: number; items: { id: number; subject: string }[] }>('search', {
      query: attachmentTag,
      limit: 5
    }, sandboxId),
    (r) => r.items.length > 0,
    120_000
  )
  const target = found.items[0]
  test.skip(!target, 'the sandbox has no mail with an attachment')
  const bands = await trpc<{ items: { id: number }[] }>('query', 'band.getAllPaginated', {
    page: 1,
    pageSize: 10
  })
  const BAND_ID = bands.items[0]?.id
  test.skip(!BAND_ID, 'the seed has no band')
  const listDocs = () =>
    trpc<{ id: number }[]>('query', 'document.listByOwner', {
      ownerType: 'band',
      ownerId: BAND_ID
    })
  const before = await listDocs()

  await openMailPage(sandboxId)
  const [popup] = await Promise.all([
    h.app.waitForEvent('window'),
    page.evaluate(([account, message]) => window.api.openMailWindow(account, message), [
      sandboxId,
      target.id
    ] as const)
  ])
  try {
    const reader = popup.getByRole('article', { name: 'E-Mail' })
    await expect(reader.getByRole('list', { name: 'Anhänge' })).toBeVisible({ timeout: 30_000 })
    await reader.getByRole('button', { name: /als Dokument speichern/ }).first().click()

    const dialog = popup.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Nummer').fill(String(BAND_ID))
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(popup.locator('[data-sonner-toast]').filter({ hasText: 'Als Dokument gespeichert' }))
      .toBeVisible({ timeout: 30_000 })

    // The document exists, with the mail as its origin
    const after = await listDocs()
    expect(after.length).toBe(before.length + 1)
    expect(after.some((doc) => doc.id > Math.max(...before.map((b) => b.id)))).toBe(true)
  } finally {
    await popup.close()
  }
})

// B2: a folder is dragged into another one and back out. The server is the
// proof: the tree only follows the sync, so a folder that vanished after a sync
// would fail the second check.
const MOVE_PREFIX = 'E2E-Move-'

test('a folder is moved into another folder by drag and drop', async () => {
  test.setTimeout(240_000)
  const { page } = h
  const sandboxId = await ensureSandboxAccount()
  await waitForInbox(sandboxId)
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
  const stamp = Date.now()
  const parent = `${MOVE_PREFIX}Ziel-${stamp}`
  const child = `${MOVE_PREFIX}Quelle-${stamp}`
  const tree = page.getByRole('list', { name: 'Ordner' })

  const serverPaths = async (): Promise<string[]> => {
    const { ImapFlow } = await import('imapflow')
    const client = new ImapFlow({
      host: SANDBOX.host,
      port: SANDBOX.port,
      secure: false,
      auth: { user: SANDBOX_USER, pass: SANDBOX_PASS },
      logger: false
    })
    await client.connect()
    try {
      return (await client.list()).map((f) => f.path)
    } finally {
      await client.logout().catch(() => client.close())
    }
  }

  await openMailPage(sandboxId)
  try {
    // 1. Two top-level folders through the tree menu
    for (const name of [parent, child]) {
      await tree.getByRole('button', { name: /^Posteingang/ }).last().click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Neuer Ordner…' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Name').fill(name)
      await dialog.getByRole('button', { name: 'Speichern' }).click()
      await expect(tree.getByRole('button', { name })).toBeVisible({ timeout: 30_000 })
    }

    // 2. Drag the child onto the parent
    await tree
      .getByRole('button', { name: child })
      .dragTo(tree.getByRole('button', { name: parent }))

    // 3. The server has the new path; the tree follows the sync
    await waitFor(
      async () => serverPaths(),
      (paths) => paths.includes(`${parent}/${child}`),
      60_000
    )
    await expect(tree.getByRole('button', { name: child })).toHaveCount(0, { timeout: 30_000 })

    // 4. It is still there after a sync - the store must not prune it
    await mail('triggerSync', true, sandboxId).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(await serverPaths()).toContain(`${parent}/${child}`)
  } finally {
    // The sandbox is left as it was found, also when a step failed
    const { ImapFlow } = await import('imapflow')
    const client = new ImapFlow({
      host: SANDBOX.host,
      port: SANDBOX.port,
      secure: false,
      auth: { user: SANDBOX_USER, pass: SANDBOX_PASS },
      logger: false
    })
    await client.connect()
    try {
      const paths = (await client.list())
        .map((f) => f.path)
        .filter((p) => p.startsWith(MOVE_PREFIX))
      // deepest first, so a parent is empty when it is deleted
      for (const p of paths.sort((a, b) => b.length - a.length)) {
        await client.mailboxDelete(p).catch(() => undefined)
      }
    } finally {
      await client.logout().catch(() => client.close())
    }
  }
})
