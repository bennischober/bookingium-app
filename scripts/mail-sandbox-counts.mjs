#!/usr/bin/env node
// Per-folder message counts of the E2E mailbox on the local mail sandbox, so the
// "leave the sandbox as it was" rule can be checked around a Playwright run:
//
//   node scripts/mail-sandbox-counts.mjs > before.txt
//   npx playwright test tests/e2e/mail-client.spec.ts
//   node scripts/mail-sandbox-counts.mjs > after.txt
//   diff before.txt after.txt
//
// Counts only: no subjects, addresses or bodies are printed. The host is fixed to
// loopback on purpose - this script must never reach a real mail server.
import { ImapFlow } from 'imapflow'

const HOST = '127.0.0.1'
const PORT = 10143
// Same mailbox as tests/e2e/helpers/mailSandbox.ts (E2E_MAIL_USER / E2E_MAIL_PASS)
const USER = 'bookingum-e2e@example.test'
const PASS = 'testpass'

async function main() {
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false
  })

  try {
    await client.connect()
  } catch (error) {
    console.error(`sandbox not reachable on ${HOST}:${PORT}: ${error.message}`)
    process.exitCode = 1
    return
  }

  try {
    const folders = (await client.list()).map((box) => box.path).sort()
    for (const path of folders) {
      const status = await client.status(path, { messages: true })
      console.log(`${path}\t${status.messages}`)
    }
  } finally {
    await client.logout().catch(() => client.close())
  }
}

await main()
