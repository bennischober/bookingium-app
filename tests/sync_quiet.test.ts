// The settings point at this computer's cloud client when nothing of the others arrives
import { describe, expect, it } from 'vitest'
import { QUIET_AFTER_MS, othersQuietSince } from '../src/renderer/src/components/settings/syncQuiet'
import { latestOf } from '../src/main/sync/format'

const now = new Date('2026-11-20T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const device = (patch: Partial<Parameters<typeof othersQuietSince>[0][number]>) => ({
  self: false,
  superseded: false,
  createdAt: ago(30 * 24 * 3600_000),
  lastSeenAt: null,
  ...patch
})

describe('others quiet', () => {
  it('says nothing for a computer alone in the group', () => {
    expect(othersQuietSince([device({ self: true })], now)).toBeNull()
  })

  it('says nothing while one other computer was seen recently', () => {
    const devices = [
      device({ self: true }),
      device({ lastSeenAt: ago(QUIET_AFTER_MS * 3) }),
      device({ lastSeenAt: ago(60_000) })
    ]
    expect(othersQuietSince(devices, now)).toBeNull()
  })

  it('names the newest sign when every other computer is quiet', () => {
    const newest = ago(QUIET_AFTER_MS + 60_000)
    const devices = [
      device({ self: true, lastSeenAt: ago(0) }),
      device({ lastSeenAt: newest }),
      device({ lastSeenAt: null, createdAt: ago(QUIET_AFTER_MS * 4) })
    ]
    expect(othersQuietSince(devices, now)).toBe(newest)
  })

  it('ignores earlier entries of a computer that joined again', () => {
    const devices = [
      device({ self: true }),
      device({ superseded: true, lastSeenAt: ago(QUIET_AFTER_MS * 5) }),
      device({ lastSeenAt: ago(1000) })
    ]
    expect(othersQuietSince(devices, now)).toBeNull()
  })

  it('takes the later of the last run and the last changes', () => {
    expect(latestOf(null, null)).toBeNull()
    expect(latestOf('2026-11-19T09:37:00Z', null)).toBe('2026-11-19T09:37:00Z')
    expect(latestOf('2026-11-19T09:37:00Z', '2026-11-20T08:00:00Z')).toBe('2026-11-20T08:00:00Z')
  })
})
