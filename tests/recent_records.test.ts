// "Zuletzt geöffnet" in the search palette: newest first, one entry per record, at most six
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Module = typeof import('../src/renderer/src/lib/recentRecords')

let recent: Module
const stored = new Map<string, string>()

beforeEach(async () => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value)
  })
  vi.resetModules()
  recent = await import('../src/renderer/src/lib/recentRecords')
})

const band = (id: number, label = `Band ${id}`) => ({
  href: `/band/${id}`,
  label,
  kind: 'band' as const
})

describe('recent records', () => {
  it('puts the last opened record first and keeps one entry per record', () => {
    recent.rememberRecord(band(1))
    recent.rememberRecord(band(2))
    recent.rememberRecord(band(1))
    expect(recent.getRecentRecords().map((r) => r.href)).toEqual(['/band/1', '/band/2'])
  })

  it('keeps at most six', () => {
    for (let id = 1; id <= 8; id++) recent.rememberRecord(band(id))
    const hrefs = recent.getRecentRecords().map((r) => r.href)
    expect(hrefs).toHaveLength(recent.RECENT_RECORDS_LIMIT)
    expect(hrefs[0]).toBe('/band/8')
    expect(hrefs).not.toContain('/band/2')
  })

  it('shows a renamed record under its new name', () => {
    recent.rememberRecord(band(1, 'Alter Name'))
    recent.rememberRecord(band(2))
    recent.rememberRecord(band(1, 'Neuer Name'))
    expect(recent.getRecentRecords()).toEqual([band(1, 'Neuer Name'), band(2)])
  })

  it('drops a record that is gone and tells the listeners', () => {
    const listener = vi.fn()
    recent.subscribeRecentRecords(listener)
    recent.rememberRecord(band(1))
    recent.rememberRecord(band(2))
    recent.forgetRecord('/band/1')
    recent.forgetRecord('/band/99')
    expect(recent.getRecentRecords()).toEqual([band(2)])
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('does not write again when the first record is opened again', () => {
    const listener = vi.fn()
    recent.subscribeRecentRecords(listener)
    recent.rememberRecord(band(1))
    recent.rememberRecord(band(1))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('survives a restart and skips broken entries', async () => {
    stored.set(
      'bookingium-recent-records',
      JSON.stringify([band(1), { href: 'kaputt', label: 'x', kind: 'band' }, { kind: 'alien' }])
    )
    vi.resetModules()
    recent = await import('../src/renderer/src/lib/recentRecords')
    expect(recent.getRecentRecords()).toEqual([band(1)])
  })

  it('reads unreadable storage as empty', async () => {
    stored.set('bookingium-recent-records', '{nicht json')
    vi.resetModules()
    recent = await import('../src/renderer/src/lib/recentRecords')
    expect(recent.getRecentRecords()).toEqual([])
  })
})
