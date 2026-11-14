// #157: adaptive pacing of the sync connection. The pause starts at the account's floor, doubles
// on a throttling signal (RFC 5530 [LIMIT]/[UNAVAILABLE]/[INUSE], ETHROTTLE, BYE, a lost
// connection, an answer far slower than the median), never past the cap, and shrinks back after
// normal answers. The circuit breaker stays the last resort.
//
// Every server here is tests/helpers/scriptedImap.ts on 127.0.0.1; the messages are synthetic.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Pacer,
  PACER_KV_KEY,
  PACER_TUNING,
  parseRememberedPause,
  throttleSignalOf
} from '../src/main/mailclient/core/pacer'
import { passSummaryLine } from '../src/main/mailclient/core/pass_summary'
import { Store } from '../src/main/mailclient/core/store'
import { makeLiveAccount, makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'
import { SyncConnection } from '../src/main/mailclient/core/sync_connection'
import { ConnectionBudget } from '../src/main/mailclient/core/connection_budget'
import type { PassSummary, SyncProgress } from '../src/main/mailclient/core/types'
import { pacingText, passSummaryText } from '@/components/mail/syncProgress'
import { scriptedImap, type FakeFolder, type ScriptedImap } from './helpers/scriptedImap'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

const FLOORS = { census: 0, sweep: 0, batch: 0 }

/** A pacer whose sleeps are recorded instead of waited */
function recorded(floors = FLOORS, start = 0): { pacer: Pacer; slept: number[]; saved: number[] } {
  const slept: number[] = []
  const saved: number[] = []
  const pacer = new Pacer(
    floors,
    start,
    (ms) => saved.push(ms),
    async (ms) => {
      slept.push(ms)
    }
  )
  return { pacer, slept, saved }
}

/** imapflow's error for a tagged NO with a response code */
const noWith = (code: string, text = 'slow down'): Error =>
  Object.assign(new Error('Command failed'), {
    responseStatus: 'NO',
    responseText: text,
    response: {
      tag: 'A1',
      command: 'NO',
      attributes: [{ type: 'SECTION', section: [{ type: 'ATOM', value: code }] }]
    }
  })

describe('#157: what counts as a throttling signal', () => {
  it('reads RFC 5530 codes, ETHROTTLE, BYE and a lost connection', () => {
    expect(throttleSignalOf(noWith('LIMIT'))).toBe('limit')
    expect(throttleSignalOf(noWith('UNAVAILABLE'))).toBe('limit')
    expect(throttleSignalOf(noWith('INUSE'))).toBe('limit')
    // the code only in the text, e.g. after a proxy
    expect(
      throttleSignalOf(
        Object.assign(new Error('Command failed'), {
          responseStatus: 'NO',
          responseText: '[LIMIT] too fast'
        })
      )
    ).toBe('limit')
    expect(
      throttleSignalOf(
        Object.assign(new Error('throttled'), { code: 'ETHROTTLE', throttleReset: 1000 })
      )
    ).toBe('limit')
    expect(
      throttleSignalOf(
        Object.assign(new Error('bye'), { code: 'NoConnection', responseStatus: 'BYE' })
      )
    ).toBe('bye')
    expect(
      throttleSignalOf(
        Object.assign(new Error('Connection not available'), { code: 'NoConnection' })
      )
    ).toBe('disconnect')
    expect(
      throttleSignalOf(Object.assign(new Error('closed'), { code: 'EConnectionClosed' }))
    ).toBe('disconnect')
  })

  it('leaves ordinary failures alone', () => {
    expect(throttleSignalOf(noWith('NONEXISTENT', 'no such mailbox'))).toBeNull()
    expect(throttleSignalOf(noWith('SERVERBUG'))).toBeNull()
    expect(
      throttleSignalOf(
        Object.assign(new Error('Command failed'), {
          responseStatus: 'NO',
          responseText: 'status refused'
        })
      )
    ).toBeNull()
    expect(throttleSignalOf(new Error('boom'))).toBeNull()
    expect(throttleSignalOf(null)).toBeNull()
    expect(throttleSignalOf('LIMIT')).toBeNull()
  })
})

describe('#157: the pacer', () => {
  it('waits only the floor until the server signals', async () => {
    const { pacer, slept } = recorded({ census: 0, sweep: 0, batch: 100 })
    await pacer.pace('census')
    await pacer.pace('sweep')
    await pacer.pace('batch')
    expect(slept).toEqual([100])
    expect(pacer.pauseFor('census')).toBe(0)
  })

  it('doubles on each signal from the first step, never past the cap', () => {
    const { pacer } = recorded({ census: 50, sweep: 0, batch: 100 })
    const seen: number[] = []
    for (let i = 0; i < 8; i++) {
      pacer.signal('limit')
      seen.push(pacer.currentMs)
    }
    expect(seen).toEqual([100, 200, 400, 800, 1600, 2000, 2000, 2000])
    // the floors stay below the learned part
    expect(pacer.pauseFor('census')).toBe(2050)
    expect(pacer.pauseFor('batch')).toBe(2100)
    expect(pacer.signalCounts.limit).toBe(8)
  })

  it('shrinks by a fifth every few normal answers, back to 0', () => {
    const { pacer } = recorded(FLOORS, 400)
    for (let i = 0; i < PACER_TUNING.recoverEvery - 1; i++) pacer.normal()
    expect(pacer.currentMs).toBe(400)
    pacer.normal()
    expect(pacer.currentMs).toBe(320)
    let answers = PACER_TUNING.recoverEvery
    while (pacer.currentMs > 0 && answers < 1000) {
      pacer.normal()
      answers++
    }
    expect(pacer.currentMs).toBe(0)
    // a signal in between starts the count of normal answers afresh
    pacer.signal('bye')
    for (let i = 0; i < PACER_TUNING.recoverEvery - 1; i++) pacer.normal()
    pacer.signal('disconnect')
    for (let i = 0; i < PACER_TUNING.recoverEvery - 1; i++) pacer.normal()
    expect(pacer.currentMs).toBe(200)
  })

  it('reads a slow answer only against the median and above the absolute floor', () => {
    const { pacer } = recorded()
    // too few samples: even a very slow answer is no signal yet
    pacer.answered(5000)
    expect(pacer.currentMs).toBe(0)
    for (let i = 0; i < PACER_TUNING.minSamples; i++) pacer.answered(40)
    // jitter: 20 times the median, but under 750 ms
    pacer.answered(700)
    expect(pacer.currentMs).toBe(0)
    pacer.answered(900)
    expect(pacer.currentMs).toBe(100)
    expect(pacer.signalCounts.slow).toBe(1)
  })

  it('does not read a slow server as throttling', () => {
    const { pacer } = recorded()
    // a far-away server: every answer takes about a second
    for (let i = 0; i < 20; i++) pacer.answered(1000 + (i % 3) * 100)
    expect(pacer.currentMs).toBe(0)
  })

  it('times a command and reads its error, rethrowing it', async () => {
    let t = 0
    const pacer = new Pacer(
      FLOORS,
      0,
      () => undefined,
      async () => undefined,
      () => t
    )
    await expect(
      pacer.timed(async () => {
        t += 30
        return 'ok'
      })
    ).resolves.toBe('ok')
    await expect(
      pacer.timed(async () => {
        throw noWith('LIMIT')
      })
    ).rejects.toThrow('Command failed')
    expect(pacer.currentMs).toBe(100)
    await expect(
      pacer.timed(async () => {
        throw new Error('no such mailbox')
      })
    ).rejects.toThrow('no such mailbox')
    expect(pacer.currentMs).toBe(100)
  })

  it('reads an error once, whether imapflow logs it, throws it or both', () => {
    const { pacer } = recorded()
    const err = noWith('LIMIT')
    pacer.failed(err)
    pacer.failed(err)
    expect(pacer.currentMs).toBe(100)
    expect(pacer.signalCounts.limit).toBe(1)
  })

  it('does not count a STATUS that imapflow answered with false as normal', async () => {
    const { pacer } = recorded(FLOORS, 400)
    for (let i = 0; i < PACER_TUNING.recoverEvery; i++) await pacer.timed(async () => false)
    expect(pacer.currentMs).toBe(400)
  })

  it('counts the pass and remembers each change', () => {
    const { pacer, saved } = recorded(FLOORS, 200)
    pacer.beginPass()
    expect(pacer.passStats()).toEqual({ pauseMs: 200, maxPauseMs: 200, signals: 0 })
    pacer.signal('limit')
    for (let i = 0; i < PACER_TUNING.recoverEvery; i++) pacer.normal()
    expect(pacer.passStats()).toEqual({ pauseMs: 320, maxPauseMs: 400, signals: 1 })
    expect(saved).toEqual([400, 320])
    pacer.beginPass()
    expect(pacer.passStats()).toEqual({ pauseMs: 320, maxPauseMs: 320, signals: 0 })
  })

  it('takes a remembered pause only as a whole number within the cap', () => {
    expect(parseRememberedPause(null)).toBe(0)
    expect(parseRememberedPause('')).toBe(0)
    expect(parseRememberedPause('abc')).toBe(0)
    expect(parseRememberedPause('-5')).toBe(0)
    expect(parseRememberedPause('1.5')).toBe(0)
    expect(parseRememberedPause('250')).toBe(250)
    expect(parseRememberedPause('9999')).toBe(PACER_TUNING.capMs)
    expect(new Pacer(FLOORS, 50_000).currentMs).toBe(PACER_TUNING.capMs)
  })
})

describe('#157: the real-mailbox builders', () => {
  it('keep a small download floor and no fixed STATUS or sweep pause', () => {
    const account = makeLiveAccount({
      id: 'l1',
      host: 'imap.example.test',
      port: 993,
      security: 'tls',
      user: 'u',
      pass: 'p',
      dataDir: os.tmpdir()
    })
    expect(account.interBatchDelayMs).toBe(100)
    expect(account.requestDelayMs).toBeUndefined()
    expect(account.censusDelayMs).toBeUndefined()
  })
})

describe('#157: the circuit breaker stays the last resort', () => {
  it('still opens after repeated errors', () => {
    const progress = { connection: 'online' } as unknown as SyncProgress
    const events: string[] = []
    const conn = new SyncConnection(
      {
        account: makeSandboxAccount({
          id: 'cb',
          host: '127.0.0.1',
          port: 1,
          security: 'none',
          user: 'u',
          pass: 'p',
          dataDir: os.tmpdir()
        }),
        budget: new ConnectionBudget(2),
        log: {},
        progress: () => progress,
        emit: (e) => events.push(e.type),
        isStopped: () => false,
        stopAfterAuthFailure: () => undefined,
        authFailed: () => undefined,
        loadCredentials: async () => undefined,
        waitWhilePaused: async () => undefined
      },
      false
    )
    for (let i = 0; i < 4; i++) expect(conn.noteError('test')).toBe(false)
    expect(conn.noteError('test')).toBe(true)
    expect(conn.circuitOpenUntil).toBeGreaterThan(Date.now())
    expect(events).toEqual(['error'])
  })
})

// ---------- the engine, against the scripted server ----------

const source = (tag: string): string =>
  `Message-ID: <${tag}@example.test>\r\nFrom: a@example.test\r\nTo: b@example.test\r\n` +
  `Subject: synthetic\r\nDate: Thu, 01 Jan 2026 09:00:00 +0000\r\n\r\nbody ${tag}\r\n`

const PATHS = ['INBOX', 'A', 'B', 'C', 'D', 'E']

/** No LIST-STATUS: every check is one STATUS per folder, the pacer's census */
async function server(): Promise<ScriptedImap> {
  const folders: Record<string, FakeFolder> = {}
  PATHS.forEach(
    (p, i) =>
      (folders[p] = {
        uidValidity: i + 1,
        uidNext: 2,
        messages: [{ uid: 1, flags: ['\\Seen'], source: source(p.toLowerCase()) }]
      })
  )
  const imap = await scriptedImap(folders)
  cleanups.push(() => imap.close())
  return imap
}

function engineOn(port: number, dataDir: string): { engine: SyncEngine; store: Store } {
  const store = new Store(dataDir, 'p157')
  const engine = new SyncEngine(
    makeSandboxAccount({
      id: 'p157',
      host: '127.0.0.1',
      port,
      security: 'none',
      user: 'u',
      pass: 'p',
      dataDir
    }),
    store
  )
  cleanups.push(async () => {
    engine.stopPolling()
    await engine.close()
    store.close()
  })
  return { engine, store }
}

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-157-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const pacerOf = (engine: SyncEngine): Pacer => (engine as unknown as { pacer: Pacer }).pacer

describe('#157: the engine paces its census', () => {
  it('backs off on [LIMIT], reports it in the pass and remembers it', async () => {
    const imap = await server()
    const dataDir = scratch()
    const { engine, store } = engineOn(imap.port, dataDir)
    await engine.syncAll()
    expect(engine.getStatus().passHistory![0].pacing).toEqual({
      pauseMs: 0,
      maxPauseMs: 0,
      signals: 0
    })

    imap.limitStatus = 2
    await engine.syncChanges({ report: true })

    const pass = engine.getStatus().lastPass!
    expect(pass.listStatus).toBe(false)
    expect(pass.pacing).toEqual({ pauseMs: 200, maxPauseMs: 200, signals: 2 })
    expect(pass.censusPauseMs).toBe(200)
    expect(passSummaryLine(pass)).toMatch(/ pause=200ms max-pause=200ms throttled=2$/)
    expect(pacerOf(engine).signalCounts.limit).toBe(2)
    expect(store.getFlag(PACER_KV_KEY)).toBe('200')

    // a restart begins where the last run ended
    await engine.close()
    const next = new SyncEngine(
      makeSandboxAccount({
        id: 'p157',
        host: '127.0.0.1',
        port: imap.port,
        security: 'none',
        user: 'u',
        pass: 'p',
        dataDir
      }),
      store
    )
    cleanups.push(() => next.close())
    expect(pacerOf(next).currentMs).toBe(200)
  }, 30_000)

  it('backs off when the server ends the connection with BYE', async () => {
    const imap = await server()
    const { engine } = engineOn(imap.port, scratch())
    await engine.syncAll()

    imap.byeOnStatus = true
    await engine.syncChanges({ report: true })

    const counts = pacerOf(engine).signalCounts
    expect(counts.bye + counts.disconnect).toBeGreaterThanOrEqual(1)
    expect(counts.limit).toBe(0)
    expect(engine.getStatus().lastPass!.pacing!.signals).toBeGreaterThanOrEqual(1)
    expect(pacerOf(engine).currentMs).toBeGreaterThan(0)
  }, 30_000)

  it('leaves a refused STATUS without a code alone', async () => {
    const imap = await server()
    const { engine } = engineOn(imap.port, scratch())
    await engine.syncAll()

    imap.failStatus = true
    await engine.syncChanges({ report: true })

    expect(engine.getStatus().lastPass!.pacing).toEqual({ pauseMs: 0, maxPauseMs: 0, signals: 0 })
  }, 30_000)
})

describe('#157: the pacing in the sync bar and the panel', () => {
  const pass: PassSummary = {
    kind: 'changes',
    listStatus: false,
    censusPauseMs: 200,
    censusMs: 1200,
    foldersChecked: 6,
    foldersSynced: 0,
    totalMs: 1500,
    errors: 0,
    phase: 'idle',
    connection: 'online',
    at: '2026-11-14T09:30:00.000Z'
  }

  it('says nothing for a pass the server did not slow down', () => {
    expect(pacingText(pass)).toBeNull()
    expect(pacingText({ ...pass, pacing: { pauseMs: 0, maxPauseMs: 0, signals: 0 } })).toBeNull()
    expect(passSummaryText(pass)).not.toContain('gebremst')
  })

  it('names the signals and the highest pause', () => {
    expect(pacingText({ ...pass, pacing: { pauseMs: 200, maxPauseMs: 400, signals: 2 } })).toBe(
      'Vom Server gebremst: 2 Signale, Pause bis 400 ms'
    )
    expect(pacingText({ ...pass, pacing: { pauseMs: 100, maxPauseMs: 100, signals: 1 } })).toBe(
      'Vom Server gebremst: 1 Signal, Pause bis 100 ms'
    )
    // a pause learned in an earlier run, without a signal in this pass
    expect(pacingText({ ...pass, pacing: { pauseMs: 80, maxPauseMs: 100, signals: 0 } })).toBe(
      'Vom Server gebremst: 0 Signale, Pause bis 100 ms'
    )
    expect(
      passSummaryText({ ...pass, pacing: { pauseMs: 200, maxPauseMs: 400, signals: 2 } })
    ).toContain('Vom Server gebremst: 2 Signale, Pause bis 400 ms')
  })
})
