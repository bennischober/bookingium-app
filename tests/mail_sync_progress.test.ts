// #63: the sync bar's progress during the first download: messages, the mailbox's size and the
// time left, each only as far as the core knows it.
import { describe, expect, it } from 'vitest'
import { formatSize } from '@/components/mail/format'
import { remainingText, syncProgressText } from '@/components/mail/syncProgress'
import type { SyncStatus } from '../src/main/mailclient/core/types'

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
