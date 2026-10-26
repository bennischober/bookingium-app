// The fake SMTP server is the only place the SMTP AUTH behaviour can be proven without a real
// mail provider (Mailpit accepts unauthenticated mail, so it can never catch a missing AUTH).
//
// Its own correctness therefore matters: it advertised AUTH PLAIN *and* LOGIN while implementing
// only PLAIN, and answered AUTH LOGIN with 250 Ok - so a client using LOGIN would have looked
// authenticated while the server never saw its credentials. These tests pin the server's contract,
// and they need no sandbox, so they run in CI too.
import { afterEach, describe, expect, it } from 'vitest'
import nodemailer from 'nodemailer'
import { startFakeSmtp, type FakeSmtp } from './helpers/fakeSmtp'

const servers: FakeSmtp[] = []
afterEach(async () => {
  while (servers.length) await servers.pop()!.close()
})

const CREDENTIALS = { user: 'fake-auth@example.test', pass: 'richtig' }

async function transport(
  port: number,
  auth: { user: string; pass: string }
): Promise<nodemailer.Transporter> {
  const t = nodemailer.createTransport({
    host: '127.0.0.1',
    port,
    secure: false,
    auth,
    // the fake server speaks plain SMTP without STARTTLS
    ignoreTLS: true
  })
  return t
}

describe('fakeSmtp: AUTH is really required', () => {
  it('refuses AUTH LOGIN without the right credentials', async () => {
    // It used to answer 250 Ok to AUTH LOGIN, i.e. it accepted a login it never verified. A client
    // that sent no credentials that way would look authenticated - and the send test would pass.
    const server = await startFakeSmtp(CREDENTIALS)
    servers.push(server)

    const t = nodemailer.createTransport({
      host: '127.0.0.1',
      port: server.port,
      secure: false,
      ignoreTLS: true,
      // force the LOGIN mechanism, which the server advertises
      auth: { ...CREDENTIALS, pass: 'falsch', method: 'LOGIN' }
    })
    await expect(
      t.sendMail({ from: CREDENTIALS.user, to: CREDENTIALS.user, subject: 'x', text: 'y' })
    ).rejects.toThrow()
    expect(server.messages).toHaveLength(0)
  }, 30_000)

  it('accepts AUTH LOGIN with the right credentials', async () => {
    // the negative half: refusing LOGIN outright would break the legitimate case
    const server = await startFakeSmtp(CREDENTIALS)
    servers.push(server)

    const t = nodemailer.createTransport({
      host: '127.0.0.1',
      port: server.port,
      secure: false,
      ignoreTLS: true,
      auth: { ...CREDENTIALS, method: 'LOGIN' }
    })
    await t.sendMail({ from: CREDENTIALS.user, to: CREDENTIALS.user, subject: 'x', text: 'y' })
    expect(server.messages).toHaveLength(1)
    expect(server.authAttempts).toContainEqual(CREDENTIALS)
  }, 30_000)

  it('refuses MAIL FROM before any authentication', async () => {
    // the guard that makes the AUTH requirement observable at all
    const server = await startFakeSmtp(CREDENTIALS)
    servers.push(server)
    const t = await transport(server.port, { user: CREDENTIALS.user, pass: 'falsch' })
    await expect(
      t.sendMail({ from: CREDENTIALS.user, to: CREDENTIALS.user, subject: 'x', text: 'y' })
    ).rejects.toThrow()
    expect(server.messages).toHaveLength(0)
  }, 30_000)
})
