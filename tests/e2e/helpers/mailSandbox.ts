// The mail E2E suite's own mailbox on the sandbox Dovecot. The sandbox accepts any user name
// with the sandbox password and gives each its own maildir, so the suite never shares a
// mailbox (or the per-user connection limit) with testuser, which other harnesses use.
import { ImapFlow } from 'imapflow'

export const E2E_MAIL_USER = 'bookingum-e2e@example.test'
export const E2E_MAIL_PASS = 'testpass'
/** A plain top-level folder, the drop target of the drag test */
export const E2E_MAIL_FOLDER = 'Projekte'
const INBOX_COUNT = 6

function message(n: number): string {
  const date = new Date(Date.UTC(2026, 0, n, 9, 0, 0)).toUTCString().replace('GMT', '+0000')
  const html = n % 2 === 0
  const body = html
    ? `<html><body><p>Testnachricht <b>${n}</b> der E2E-Suite.</p></body></html>`
    : `Testnachricht ${n} der E2E-Suite.`
  return [
    `From: E2E Absender <absender@example.test>`,
    `To: ${E2E_MAIL_USER}`,
    `Subject: E2E test mail ${n}`,
    `Date: ${date}`,
    `Message-ID: <e2e-${n}@example.test>`,
    'MIME-Version: 1.0',
    `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=utf-8`,
    '',
    body,
    ''
  ].join('\r\n')
}

/**
 * Removes the mails a test wrote (subject starting with `subjectPrefix`) from the suite's
 * Drafts and Sent and from Mailpit, so the sandbox stays as it was — also what an earlier,
 * failed run left behind. Mailpit is shared with other harnesses: only these subjects go.
 */
export async function removeSentTestMails(
  host: string,
  port: number,
  mailpitApiPort: number,
  subjectPrefix: string
): Promise<void> {
  const client = new ImapFlow({
    host,
    port,
    secure: false,
    auth: { user: E2E_MAIL_USER, pass: E2E_MAIL_PASS },
    logger: false
  })
  await client.connect()
  try {
    for (const box of await client.list()) {
      if (box.specialUse !== '\\Drafts' && box.specialUse !== '\\Sent') continue
      await client.mailboxOpen(box.path)
      const uids = await client.search({ subject: subjectPrefix }, { uid: true })
      if (uids && uids.length) await client.messageDelete(uids, { uid: true })
    }
  } finally {
    await client.logout().catch(() => client.close())
  }
  const api = `http://${host}:${mailpitApiPort}/api/v1`
  const query = encodeURIComponent(`subject:${subjectPrefix}`)
  const found = (await (await fetch(`${api}/search?query=${query}`)).json()) as {
    messages: { ID: string; Subject: string }[]
  }
  const ids = found.messages.filter((m) => m.Subject.startsWith(subjectPrefix)).map((m) => m.ID)
  if (ids.length) {
    await fetch(`${api}/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: ids })
    })
  }
}

/** Creates the folder and tops the inbox up to its mails; a no-op on a seeded mailbox */
export async function seedMailSandbox(host: string, port: number): Promise<void> {
  const client = new ImapFlow({
    host,
    port,
    secure: false,
    auth: { user: E2E_MAIL_USER, pass: E2E_MAIL_PASS },
    logger: false
  })
  await client.connect()
  try {
    const folders = await client.list()
    if (!folders.some((f) => f.path === E2E_MAIL_FOLDER))
      await client.mailboxCreate(E2E_MAIL_FOLDER)
    const { messages = 0 } = await client.status('INBOX', { messages: true })
    for (let n = messages + 1; n <= INBOX_COUNT; n++) {
      await client.append('INBOX', message(n), [], new Date(Date.UTC(2026, 0, n, 9)))
    }
  } finally {
    await client.logout().catch(() => client.close())
  }
}
