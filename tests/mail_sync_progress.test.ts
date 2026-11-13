// #63: the sync bar's progress during the first download: messages, the mailbox's size and the
// time left, each only as far as the core knows it.
import { describe, expect, it } from 'vitest'
import { formatSize } from '@/components/mail/format'
import { passSummaryText, remainingText, syncProgressText } from '@/components/mail/syncProgress'
import type { PassSummary, SyncStatus } from '../src/main/mailclient/core/types'

const base: SyncStatus = {
  running: true,
  lastSyncAt: null,
  idleConnected: false,
  foldersSynced: 2,
  foldersTotal: 9,
  newMessages: 0,
  flagChanges: 0,
  expunged: 0,
  errors: []
}

describe('#63: the time left', () => {
  it('rounds to minutes, hours and days', () => {
    expect(remainingText(null)).toBeNull()
    expect(remainingText(0)).toBeNull()
    expect(remainingText(40)).toBe('noch ca. 1 Min.')
    expect(remainingText(25 * 60)).toBe('noch ca. 25 Min.')
    expect(remainingText(150 * 60)).toBe('noch ca. 3 Std.')
    expect(remainingText(30 * 3600)).toBe('noch ca. 1 Tag')
    expect(remainingText(80 * 3600)).toBe('noch ca. 3 Tage')
  })
})

describe('#63: the progress text', () => {
  it('shows the folders outside the first download', () => {
    expect(syncProgressText({ ...base, phase: 'incremental', messagesDone: 10 })).toBe(
      '2 / 9 Ordner'
    )
  })

  it('#156: names the two halves of the change pass of the sync button', () => {
    expect(syncProgressText({ ...base, phase: 'incremental', changePass: 'priority' })).toBe(
      'Wichtige Ordner · 2 / 9'
    )
    expect(syncProgressText({ ...base, phase: 'incremental', changePass: 'check' })).toBe(
      'Wichtige Ordner aktuell · 2 / 9 Ordner geprüft'
    )
    expect(syncProgressText({ ...base, phase: 'incremental', changePass: null })).toBe(
      '2 / 9 Ordner'
    )
  })

  it('shows messages, size and time left during the first download', () => {
    expect(
      syncProgressText({
        ...base,
        phase: 'initial',
        messagesDone: 1234,
        messagesTotal: 45000,
        bytesTotal: 3_200_000_000,
        secondsLeft: 2 * 3600
      })
    ).toBe('1.234 / 45.000 E-Mails · ca. 3,2 GB · noch ca. 2 Std.')
  })

  it('leaves out what is not known, and the time while paused', () => {
    expect(
      syncProgressText({ ...base, phase: 'initial', messagesDone: 5, messagesTotal: null })
    ).toBe('5 E-Mails')
    expect(
      syncProgressText({
        ...base,
        phase: 'paused',
        paused: true,
        messagesDone: 5,
        messagesTotal: 10,
        bytesTotal: 450_000_000,
        secondsLeft: 600
      })
    ).toBe('5 / 10 E-Mails · ca. 450 MB')
  })

  it('formats gigabytes', () => {
    expect(formatSize(12_340_000_000)).toBe('12,3 GB')
    expect(formatSize(999_000_000)).toBe('999 MB')
  })
})

describe('#156: the last pass summary', () => {
  const pass: PassSummary = {
    kind: 'changes',
    listStatus: false,
    censusPauseMs: 150,
    censusMs: 41_234,
    foldersChecked: 271,
    foldersSynced: 6,
    totalMs: 52_050,
    errors: 0,
    phase: 'idle',
    connection: 'online',
    at: '2026-11-13T09:30:00.000Z'
  }

  it('reads counts and times in German', () => {
    const lines = passSummaryText(pass).split('\n')
    expect(lines[0]).toMatch(/^Zuletzt: Synchronisieren um \d\d:\d\d$/)
    expect(lines.slice(1)).toEqual([
      '271 Ordner geprüft in 41,2 s (einzeln per STATUS, Pause 150 ms)',
      '6 Ordner synchronisiert, gesamt 52,1 s',
      '0 Fehler'
    ])
  })

  it('names LIST-STATUS, the deep check and a pass that ended early', () => {
    const text = passSummaryText({
      ...pass,
      kind: 'full',
      listStatus: true,
      errors: 2,
      phase: 'error',
      connection: 'offline'
    })
    expect(text).toContain('Zuletzt: Alle Ordner prüfen')
    expect(text).toContain('(mit einem LIST-STATUS)')
    expect(text).toContain('2 Fehler')
    expect(text).toContain('Vorzeitig beendet')
    expect(text).toContain('Verbindung danach getrennt')
  })
})
