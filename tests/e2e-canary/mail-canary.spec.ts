// A9 phase 1: the canary run - does the write path work against a REAL mailbox?
//
// The only suite that may touch a real server. I6 (MR-18) gates it three times over:
//   1. it lives outside the default `testDir` and runs only through `playwright.canary.config.ts`;
//   2. it skips unless BOOKINGIUM_CANARY=1 is set;
//   3. once that opt-in is set, a wrong setup FAILS the run instead of skipping it quietly.
//
// Setup, a manual step: the account carrying the canary FLAG (a checkbox in the account dialog,
// signed off on 2026-10-27) is saved in a profile, and BOOKINGIUM_E2E_USER_DATA points at a COPY
// of that profile. The password only ever exists as safeStorage ciphertext, so a test cannot
// create the account. The suite finds it by its flag, never by an id: ids are random UUIDs.
//
// Rules from the card, enforced here:
//   - synthetic mails only, never anything from the user's real corpus
//   - a handful of sends, to the account's OWN address only
//   - no retry after a failed login: a rejected send fails this run
//   - report COUNTS and OUTCOMES only, never mail content
//
// Phase 2 (staged writes on the real account) does NOT start from this result.
import { test, expect } from '@playwright/test'
import { launchApp, type AppHandle } from '../e2e/helpers/launch'

const SUBJECT_PREFIX = 'bookingum-canary-'

type AccountSummary = { id: string; email: string; mode: string; canWrite: boolean }

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

test.describe('A9 phase 1', () => {
  test.skip(
    process.env.BOOKINGIUM_CANARY !== '1',
    'the canary run touches a real mailbox: set BOOKINGIUM_CANARY=1 to run it on purpose'
  )

  test.beforeAll(async () => {
    // Opted in: from here on a wrong setup is a failure. A fresh temp profile cannot hold
    // the canary, so running without a profile copy would only ever fail later and vaguer.
    if (!process.env.BOOKINGIUM_E2E_USER_DATA) {
      throw new Error('BOOKINGIUM_CANARY=1 needs BOOKINGIUM_E2E_USER_DATA (a copy of the profile)')
    }
    h = await launchApp()
  })

  test.afterAll(async () => {
    await h?.close()
  })

  test('the write path works against the real canary mailbox', async () => {
    // G1: `mail.accounts.list` is the call that kills the main process under the Playwright
    // harness (see docs/mail-client-tasks.md G1). This suite asks the core instead, which
    // reports the canary as mode 'canary' since I6 (MR-18).
    const accounts = await mail<AccountSummary[]>('listAccounts')
    const canaries = accounts.filter((a) => a.mode === 'canary')
    // exactly one: main admits at most one canary, and this run must not pick between two
    expect(canaries, 'accounts carrying the canary flag').toHaveLength(1)
    const canary = canaries[0]
    expect(canary.canWrite).toBe(true)

    // Phase 1 mails the account's own address only. Without one there is nothing to
    // send to, and this run must not guess.
    const own = canary.email.trim()
    expect(own).not.toBe('')

    // 1. The real server answers, and the account is writable. A server that does not
    //    answer must fail this run rather than pass quietly. `getAccount` reads the
    //    selected account, so the canary is selected first.
    await mail('selectAccount', canary.id)
    const info = await waitFor(
      () => mail<AccountSummary>('getAccount'),
      (account) => account.canWrite
    )
    expect(info.id).toBe(canary.id)
    expect(info.mode).toBe('canary')

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
    const { messageId } = await mail<{ messageId: string }>('sendMail', draft, null, canary.id)
    expect(messageId).toBeTruthy()

    // 3. It arrived in Sent exactly once - a single delivery, never a duplicate
    const folders = await mail<{ id: string; imap_path: string; special_use?: string }[]>(
      'getFolders',
      canary.id
    )
    const sent = folders.find((f) => f.special_use === '\\Sent' || f.imap_path === 'Sent')
    expect(sent).toBeTruthy()

    const items = await waitFor(
      () =>
        mail<{ subject: string }[]>('listMessages', sent!.id, { offset: 0, limit: 50 }, canary.id),
      (rows) => rows.some((m) => m.subject === subject)
    )
    const copies = items.filter((m) => m.subject === subject)
    expect(copies).toHaveLength(1)

    // Counts and outcomes only - never mail content
    console.log(
      `A9 phase 1: mode=${info.mode} canWrite=${info.canWrite} send=done copies=${copies.length}`
    )
  })
})
