// #159: the sync activity panel. The core keeps the last passes and the sync errors still standing:
// a folder's error outlives the pass that hit it and ends when that folder syncs again, an error
// of the whole pass ends with the next pass that has none. The renderer turns them into German
// text, counts and folder names only.
//
// Every server here is tests/helpers/scriptedImap.ts on 127.0.0.1; the messages are synthetic.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PASS_HISTORY_MAX,
  SYNC_ERRORS_MAX,
  SyncActivity,
  syncErrorKey
} from '../src/main/mailclient/core/sync_activity'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'
import {
  durationText,
  folderErrorMap,
  passFacts,
  passOutcome,
  passTitle,
  syncActivityReport,
  syncErrorSeen,
  syncErrorsOf,
  syncErrorText
} from '@/components/mail/syncActivity'
import type { PassSummary, SyncStatus } from '../src/main/mailclient/core/types'
import { scriptedImap, type FakeFolder, type ScriptedImap } from './helpers/scriptedImap'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

const pass = (over: Partial<PassSummary> = {}): PassSummary => ({
  kind: 'changes',
  listStatus: true,
  censusPauseMs: 150,
  censusMs: 120,
  foldersChecked: 276,
  foldersSynced: 5,
  totalMs: 4200,
  errors: 0,
  phase: 'idle',
  connection: 'online',
  at: '2026-11-14T11:03:00.000Z',
  trigger: 'user',
  newMessages: 0,
  flagChanges: 0,
  expunged: 0,
  ...over
})

describe('#159: SyncActivity', () => {
  it('keeps the last passes, newest first', () => {
    const a = new SyncActivity()
    for (let i = 0; i < PASS_HISTORY_MAX + 3; i++) a.notePass(pass({ foldersSynced: i }))
    const h = a.history()
    expect(h).toHaveLength(PASS_HISTORY_MAX)
    expect(h[0].foldersSynced).toBe(PASS_HISTORY_MAX + 2)
    expect(h.at(-1)!.foldersSynced).toBe(3)
    // copies: changing one does not change the history
    h[0].foldersSynced = -1
    expect(a.history()[0].foldersSynced).toBe(PASS_HISTORY_MAX + 2)
  })

  it('counts a repeated error once, last seen first', () => {
    const a = new SyncActivity()
    a.noteError('A', 'NO select refused', '2026-11-14T10:00:00.000Z')
    a.noteError(
      null,
      'circuit open: waiting 23s before next server contact',
      '2026-11-14T10:01:00.000Z'
    )
    a.noteError('A', 'NO select refused again', '2026-11-14T10:02:00.000Z')
    a.noteError(
      null,
      'circuit open: waiting 41s before next server contact',
      '2026-11-14T10:03:00.000Z'
    )
    const e = a.errors()
    expect(e.map((x) => x.key)).toEqual([
      syncErrorKey(null, 'circuit open: waiting 1s before next server contact'),
      'folder:A'
    ])
    expect(e[0]).toMatchObject({
      count: 2,
      firstAt: '2026-11-14T10:01:00.000Z',
      lastAt: '2026-11-14T10:03:00.000Z'
    })
    // the folder's latest message wins
    expect(e[1]).toMatchObject({ path: 'A', message: 'NO select refused again', count: 2 })
  })

  it('ends a folder error on that folder, pass errors on a clean pass, any on dismiss', () => {
    const a = new SyncActivity()
    a.noteError('A', 'x')
    a.noteError('B', 'y')
    a.noteError(null, 'poll: no folder answered (3 tried)')
    a.noteFolderDone('A')
    expect(a.errors().map((e) => e.path)).toEqual([null, 'B'])
    a.clearPassErrors()
    expect(a.errors().map((e) => e.path)).toEqual(['B'])
    a.noteError('C', 'z')
    a.dismiss(['folder:B'])
    expect(a.errors().map((e) => e.path)).toEqual(['C'])
    a.dismiss()
    expect(a.errors()).toEqual([])
  })

  it('caps the errors, dropping the one seen longest ago', () => {
    const a = new SyncActivity()
    for (let i = 0; i < SYNC_ERRORS_MAX + 5; i++) a.noteError(`F${i}`, 'x')
    const e = a.errors()
    expect(e).toHaveLength(SYNC_ERRORS_MAX)
    expect(e[0].path).toBe(`F${SYNC_ERRORS_MAX + 4}`)
    expect(e.some((x) => x.path === 'F0')).toBe(false)
  })
})

// ---------- the engine, against the scripted server ----------

const source = (tag: string): string =>
  `Message-ID: <${tag}@example.test>\r\nFrom: a@example.test\r\nTo: b@example.test\r\n` +
  `Subject: synthetic\r\nDate: Thu, 01 Jan 2026 09:00:00 +0000\r\n\r\nbody ${tag}\r\n`

const folder = (uidValidity: number, tag: string): FakeFolder => ({
  uidValidity,
  uidNext: 2,
  messages: [{ uid: 1, flags: ['\\Seen'], source: source(tag) }]
})

async function server(): Promise<ScriptedImap> {
  const folders: Record<string, FakeFolder> = {}
  ;['INBOX', 'A', 'B'].forEach((p, i) => (folders[p] = folder(i + 1, p.toLowerCase())))
  const imap = await scriptedImap(folders)
  imap.capabilities = ['LIST-STATUS']
  cleanups.push(() => imap.close())
  return imap
}

function engineFor(port: number): { engine: SyncEngine; store: Store } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-159-'))
  cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const store = new Store(dataDir, 'c159')
  const engine = new SyncEngine(
    makeSandboxAccount({
      id: 'c159',
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

describe('#159: the engine keeps errors past their pass', () => {
  it('a folder error survives the next pass and ends when the folder syncs', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)

    await engine.syncAll()
    let s = engine.getStatus()
    expect(s.syncErrors).toEqual([])
    expect(s.passHistory!.map((p) => [p.kind, p.trigger])).toEqual([['all', 'auto']])
    // not a pass the user started
    expect(s.lastPass ?? null).toBeNull()

    // opening B fails: the server refuses its SELECT
    imap.failSelect.add('B')
    expect(await engine.syncOpened(store.getFolderByPath('B')!.id)).toBe('failed')
    s = engine.getStatus()
    expect(s.syncErrors!.map((e) => e.path)).toEqual(['B'])
    expect(s.syncErrors![0].message).toContain('select refused')

    // the change pass does not reach B (nothing changed there): the pass's own list is empty,
    // the error stays
    await engine.syncChanges({ report: true })
    s = engine.getStatus()
    expect(s.errors).toEqual([])
    expect(s.syncErrors!.map((e) => e.path)).toEqual(['B'])
    expect(s.passHistory!.map((p) => [p.kind, p.trigger])).toEqual([
      ['changes', 'user'],
      ['all', 'auto']
    ])
    expect(s.lastPass).toMatchObject({ kind: 'changes', trigger: 'user' })

    // the server answers again: the deep check syncs B, and its error is over
    imap.failSelect.clear()
    await engine.syncAll({ full: true, report: true })
    s = engine.getStatus()
    expect(s.syncErrors).toEqual([])
    expect(s.passHistory![0]).toMatchObject({ kind: 'full', trigger: 'user', errors: 0 })
  })

  it('a pass error ends with the next pass that has none; dismiss hides the rest', async () => {
    const imap = await server()
    const { engine } = engineFor(imap.port)
    await engine.syncAll()

    imap.failStatus = true
    // LIST-STATUS would still answer; without it every STATUS is refused
    imap.capabilities = []
    await engine.close()
    await engine.syncChanges()
    let s = engine.getStatus()
    expect(s.syncErrors!.some((e) => e.path === null)).toBe(true)

    imap.failStatus = false
    await engine.syncChanges()
    s = engine.getStatus()
    expect(s.syncErrors!.filter((e) => e.path === null)).toEqual([])

    imap.failSelect.add('A')
    await engine.syncAll({ full: true })
    s = engine.getStatus()
    expect(s.syncErrors!.map((e) => e.path)).toEqual(['A'])
    expect(s.passHistory![0].errors).toBeGreaterThan(0)
    engine.dismissSyncErrors(null)
    expect(engine.getStatus().syncErrors).toEqual([])
  })
})

// ---------- the panel's text ----------

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  running: false,
  lastSyncAt: '2026-11-14T11:03:00.000Z',
  idleConnected: true,
  foldersSynced: 0,
  foldersTotal: 0,
  newMessages: 0,
  flagChanges: 0,
  expunged: 0,
  errors: [],
  connection: 'online',
  ...over
})

describe('#159: the panel text', () => {
  it('names the pass by its button, or as automatic', () => {
    expect(passTitle(pass())).toBe('Synchronisieren')
    expect(passTitle(pass({ kind: 'full' }))).toBe('Alle Ordner prüfen')
    expect(passTitle(pass({ kind: 'all' }))).toBe('Synchronisieren')
    expect(passTitle(pass({ kind: 'all', trigger: 'auto' }))).toBe('Automatischer Abgleich')
  })

  it('puts the counts in one line, leaving out the zeros', () => {
    const line = passFacts(pass({ newMessages: 3, errors: 1, flagChanges: 1 }))
    expect(line).toContain('4,2 s')
    expect(line).toContain('276 Ordner geprüft')
    expect(line).toContain('5 Ordner synchronisiert')
    expect(line).toContain('3 neue E-Mails')
    expect(line).toContain('1 Markierung geändert')
    expect(line).toContain('1 Fehler')
    expect(line).not.toContain('entfernt')
    expect(durationText(185_000)).toBe('3 Min. 5 s')
    expect(durationText(120_000)).toBe('2 Min.')
  })

  it('says how a pass ended when not as planned', () => {
    expect(passOutcome(pass())).toBeNull()
    expect(passOutcome(pass({ phase: 'error' }))).toBe('Vorzeitig beendet')
    expect(passOutcome(pass({ phase: 'paused' }))).toBe('Pausiert')
    expect(passOutcome(pass({ connection: 'offline' }))).toBe('Verbindung danach getrennt')
  })

  it('translates the known errors and leaves others as they are', () => {
    expect(
      syncErrorText('login rejected: no further attempts until the account is saved again')
    ).toMatch(/Anmeldung/)
    expect(syncErrorText('circuit open: waiting 23s before next server contact')).toMatch(
      /Zu viele Fehler/
    )
    expect(syncErrorText("Command failed: NO [NONEXISTENT] Mailbox doesn't exist")).toMatch(
      /gibt es auf dem Server nicht/
    )
    expect(syncErrorText('idle: Socket timeout')).toMatch(/nicht rechtzeitig/)
    expect(syncErrorText('connect ECONNREFUSED 127.0.0.1:993')).toMatch(/nicht erreichbar/)
    expect(syncErrorText('Connection closed')).toMatch(/unterbrochen/)
    expect(syncErrorText('NO [OVERQUOTA] quota exceeded')).toMatch(/Speicherplatz/)
    expect(syncErrorText('NO [SERVERBUG] select refused')).toMatch(/Befehl abgelehnt/)
    expect(syncErrorText('something new')).toBeNull()
  })

  it('marks the failed folders by path, pass errors not', () => {
    const map = folderErrorMap(
      status({
        syncErrors: [
          {
            key: 'folder:A',
            path: 'A',
            message: 'Connection closed',
            firstAt: 'x',
            lastAt: 'x',
            count: 1
          },
          { key: 'pass:x', path: null, message: 'poll: x', firstAt: 'x', lastAt: 'x', count: 1 }
        ]
      })
    )
    expect([...map.keys()]).toEqual(['A'])
    expect(map.get('A')).toMatch(/unterbrochen/)
    expect(folderErrorMap(undefined).size).toBe(0)
  })

  it('reads the errors of an older core from the pass list', () => {
    expect(syncErrorsOf(status({ errors: ['A: x'] }))).toMatchObject([
      { path: null, message: 'A: x' }
    ])
  })

  it('counts repeated errors', () => {
    const one = {
      key: 'k',
      path: 'A',
      message: 'x',
      firstAt: '2026-11-14T10:00:00.000Z',
      lastAt: '2026-11-14T10:00:00.000Z',
      count: 1
    }
    expect(syncErrorSeen(one)).not.toContain('Mal')
    expect(syncErrorSeen({ ...one, count: 3 })).toContain('3 Mal seit')
  })

  it('writes a report of names and counts for support', () => {
    const text = syncActivityReport(
      status({
        syncErrors: [
          {
            key: 'folder:Kunden/A',
            path: 'Kunden/A',
            message: 'Connection closed',
            firstAt: '2026-11-14T10:00:00.000Z',
            lastAt: '2026-11-14T10:05:00.000Z',
            count: 2
          }
        ],
        passHistory: [pass({ newMessages: 2 })]
      }),
      (p) => p.split('/').at(-1)!,
      new Date('2026-11-14T11:10:00.000Z')
    )
    expect(text).toContain('Fehler:')
    expect(text).toContain('- A: Die Verbindung zum Server wurde unterbrochen.')
    expect(text).toContain('  Meldung: Connection closed')
    expect(text).toContain('Letzte Durchläufe:')
    expect(text).toContain('- Synchronisieren: ')
    expect(text).toContain('(LIST-STATUS)')
    expect(syncActivityReport(status(), (p) => p)).toContain('Keine Fehler.')
  })
})
