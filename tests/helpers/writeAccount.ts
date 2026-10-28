// A7: the write path takes its endpoints per account. Tests that drive the
// WriteEngine directly need a sandbox account on the local test server, which is
// exactly what this builds - the same shape the host produces in production.
import type { WriteAccount } from '../src/main/mailclient/core/write_guard'

export const SANDBOX_HOST = '127.0.0.1'
export const SANDBOX_IMAP_PORT = 10143
export const SANDBOX_SMTP_PORT = 1025
export const SANDBOX_USER = 'bookingum-e2e@example.test'
export const SANDBOX_PASS = 'testpass'

/** A sandbox write account on the local server (the only kind writes are allowed for) */
export function sandboxWriteAccount(over: Partial<WriteAccount> = {}): WriteAccount {
  return {
    id: 'sandbox',
    readOnly: false,
    imapHost: SANDBOX_HOST,
    imapPort: SANDBOX_IMAP_PORT,
    security: 'none',
    smtpHost: SANDBOX_HOST,
    smtpPort: SANDBOX_SMTP_PORT,
    ...over
  }
}

/** Credentials for that account, as the host would supply them */
export const sandboxCredentials = (): Promise<{ user: string; pass: string }> =>
  Promise.resolve({ user: SANDBOX_USER, pass: SANDBOX_PASS })
