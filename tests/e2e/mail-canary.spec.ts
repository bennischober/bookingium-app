// A9 phase 1: the canary run - does the write path work against a REAL mailbox?
//
// The only suite that may touch a real server. Gated so it skips visibly instead:
//   1. an account whose id is CANARY_ACCOUNT_ID must be saved in the app's profile.
//      That is a manual step: the password only ever exists as safeStorage
//      ciphertext, so a test cannot create it.
//   2. that account must carry an address, which is the only one it may mail.
//
// Rules from the card, enforced here:
//   - synthetic mails only, never anything from the user's real corpus
//   - a handful of sends, to the account's OWN address only
//   - no retry after a failed login: a rejected send fails this run
//   - report COUNTS and OUTCOMES only, never mail content
//
// Phase 2 (staged writes on the real account) does NOT start from this result.
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from './helpers/launch'

const CANARY_ID = 'canary'
const SUBJECT_PREFIX = 'bookingum-canary-'

type MailAccount = {
  id: string
  kind: string
  email: string
  canary: boolean
}

type AccountInfo = { id: string; email: string; mode: string; canWrite: boolean }

let h: AppHandle

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
        w.electronTRPC.sendMessage({ method: 'request', id, type, path, input })
      }),
    { type, path, input }
  )
}

const mail = <T>(method: string, ...args: unknown[]): Promise<T> =>
  trpc<T>('mutation', 'mail.call', { method, args })

/** Waits for a predicate, so a slow real server is not a failure */
async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (value: T) => boolean,
  timeoutMs = 90_000
): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (ok(value)) return value
    if (Date.now() > until) throw new Error('timeout waiting for the canary mailbox')
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

test.beforeAll(async () => {
  h = await launchApp()
})

test.afterAll(async () => {
  await h.close()
})

test('A9 phase 1: the write path works against the real canary mailbox', async () => {
  test.setTimeout(300_000)

  // G1: opening the mail settings page currently kills the main process (pre-existing, see
  // docs/mail-client-tasks.md G1), so this suite cannot reach the account list until that
  // is fixed. It skips visibly rather than failing on an unrelated defect.
  const accounts = await trpc<MailAccount[]>('query', 'mail.accounts.list').catch(() => null)
  test.skip(
    accounts === null,
    'the mail settings page cannot load while G1 is open: fix that first, then run this suite'
  )
  const canary = accounts.find((a) => a.id === CANARY_ID)
  test.skip(
    !canary,
    `no canary account saved (id "${CANARY_ID}"): add it once in Einstellungen, then re-run`
  )

  // The guard admits exactly this account by name, and it is saved as a sandbox
  // account so it gets the write path at all
  expect(canary!.canary).toBe(true)
  expect(canary!.kind).toBe('sandbox')

  // Phase 1 mails the account's own address only. Without one there is nothing to
  // send to, and this run must not guess.
  const own = canary!.email.trim()
  expect(own).not.toBe('')

  // 1. The real server answers, and the account is writable. A server that does not
  //    answer must fail this run rather than pass quietly.
  const info = await waitFor(
    () => mail<AccountInfo>('getAccount', CANARY_ID),
    (account) => account.canWrite
  )
  expect(info.mode).toBe('canary')
  expect(info.canWrite).toBe(true)

  // 2. One synthetic mail, from this app to the account's own address. One send,
  //    no retry: a rejected login fails this run.
  const subject = `${SUBJECT_PREFIX}${Date.now()}`
  const draft = {
    to: [{ name: '', email: own }],
    cc: [],
    bcc: [],
    subject,
    bodyText: 'Synthetische Testnachricht der Canary-Pruefung.',
    bodyHtml: '<div dir="auto">Synthetische Testnachricht der Canary-Pruefung.</div>',
    inReplyTo: null,
    references: [],
    attachments: []
  }
  const { messageId } = await mail<{ messageId: string }>('sendMail', draft, null, CANARY_ID)
  expect(messageId).toBeTruthy()

  // 3. It arrived in Sent exactly once - a single delivery, never a duplicate
  const folders = await mail<{ id: string; imap_path: string; special_use?: string }[]>(
    'getFolders',
    CANARY_ID
  )
  const sent = folders.find((f) => f.special_use === '\\Sent' || f.imap_path === 'Sent')
  expect(sent).toBeTruthy()

  const items = await waitFor(
    () =>
      mail<{ subject: string; messageId?: string }[]>(
        'listMessages',
        sent!.id,
        { offset: 0, limit: 50 },
        CANARY_ID
      ),
    (rows) => rows.some((m) => m.subject === subject)
  )
  const copies = items.filter((m) => m.subject === subject)
  expect(copies).toHaveLength(1)

  // Counts and outcomes only - never mail content
  console.log(
    `A9 phase 1: mode=${info.mode} canWrite=${info.canWrite} ` + `send=done copies=${copies.length}`
  )
})
