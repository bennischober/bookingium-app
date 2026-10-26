// H1: "Synchronisiert HH:MM" must mean "we last talked to the server", not "a full syncAll()
// finished once".
//
// The poll runs every 2 minutes and is what keeps the mailbox current, but it never touched
// lastSyncAt - so the label could sit hours in the past while the mailbox was demonstrably
// up to date. The user read that as "my mail is stale", which is exactly the question the
// label is supposed to answer.
//
// I9 NOTE - this file is PENDING ON I4, on purpose.
// Review finding L3 says this suite "asserts that the time moves, which is exactly the wrong
// behaviour of L3", but L3 is only ever NAMED in docs/mail-client-review.md (line 604, in the
// "tests that prove less" list); its required behaviour is not written down anywhere in the repo.
// Writing a test for it here would mean inventing that behaviour, and the behaviour lives in
// core/sync.ts - which is I4's file (docs/mail-client-handoff.md section 4: "I4, then I12, then
// I15a, all three change sync.ts"). So the first test below keeps its H1 claim (a poll that really
// contacted the server moves the time) and the file carries this note instead of a guess.
// I4 owns turning L3 into an assertion.
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'

type FakeServer = { port: number; close: () => Promise<void> }

/** Just enough IMAP for a full sync and a poll pass */
async function fakeImapServer(): Promise<FakeServer> {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.write('* OK [CAPABILITY IMAP4rev1] fake server ready\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const [tag, rawCommand = ''] = line.split(' ')
        const command = rawCommand.toUpperCase()
        if (command === 'CAPABILITY') {
          socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`)
        } else if (command === 'LOGIN') {
          socket.write(`${tag} OK [CAPABILITY IMAP4rev1] logged in\r\n`)
        } else if (command === 'LIST' || command === 'LSUB') {
          socket.write(`* ${command} (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK done\r\n`)
        } else if (command === 'STATUS') {
          socket.write(`* STATUS "INBOX" (MESSAGES 0)\r\n${tag} OK done\r\n`)
        } else if (command === 'LOGOUT') {
          socket.end(`* BYE logging out\r\n${tag} OK done\r\n`)
        } else {
          socket.write(`${tag} OK done\r\n`)
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      })
  }
}

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

async function engineFor(port: number): Promise<SyncEngine> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-sync-time-'))
  const store = new Store(dataDir, 'h1')
  const engine = new SyncEngine(
    makeSandboxAccount({
      id: 'h1',
      host: '127.0.0.1',
      port,
      security: 'none',
      user: 'u',
      pass: 'p',
      dataDir
    }),
    store
  )
  cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  cleanups.push(async () => {
    engine.stopPolling()
    await engine.close()
    store.close()
  })
  return engine
}

describe('H1: the sync time follows the last server contact', () => {
  it('moves on a poll pass, not only on a full sync', async () => {
    const server = await fakeImapServer()
    cleanups.push(() => server.close())
    const engine = await engineFor(server.port)

    // A full sync sets the timestamp
    await engine.syncAll()
    const afterFullSync = engine.getStatus().lastSyncAt
    expect(afterFullSync).toBeTruthy()

    // A poll pass must move it: this is what was missing, so the label could sit hours
    // in the past while the mailbox was current
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await engine.pollOnce()

    const afterPoll = engine.getStatus().lastSyncAt
    expect(afterPoll).toBeTruthy()
    expect(afterPoll).not.toBe(afterFullSync)
    expect(new Date(afterPoll!).getTime()).toBeGreaterThan(new Date(afterFullSync!).getTime())
  }, 30_000)

  it('does not move when the server cannot be reached', async () => {
    const engine = await engineFor(await closedPort())

    // Nothing ever reached a server, so there is no contact time to report
    await engine.pollOnce().catch(() => undefined)
    expect(engine.getStatus().lastSyncAt).toBeNull()
  }, 30_000)
})

/** A port on 127.0.0.1 that nothing listens on */
async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}
