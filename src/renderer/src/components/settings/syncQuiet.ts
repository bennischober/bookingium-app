// When nothing of the other computers has arrived for a long time, the cause is usually this
// computer's cloud client (OneDrive, Dropbox, Google Drive) no longer fetching the shared folder,
// not the others: the settings say so. Pure, tested in tests/sync_quiet.test.ts.

/** Silence of every other computer for this long counts as "nothing arrives" */
export const QUIET_AFTER_MS = 12 * 60 * 60_000

export interface QuietDevice {
  self: boolean
  superseded: boolean
  createdAt: string
  lastSeenAt: string | null
}

/** A device's last sign in the folder: its last run or changes, else when it joined */
export const lastSignOf = (device: QuietDevice): string => device.lastSeenAt ?? device.createdAt

/**
 * The newest sign of the other (current) computers when all of them have been quiet for
 * QUIET_AFTER_MS, else null. Null as well when this computer is alone in the group.
 */
export function othersQuietSince(devices: readonly QuietDevice[], now: Date): string | null {
  const others = devices.filter((device) => !device.self && !device.superseded)
  if (others.length === 0) return null
  const newest = others.map(lastSignOf).reduce((a, b) => (a > b ? a : b))
  return now.getTime() - new Date(newest).getTime() >= QUIET_AFTER_MS ? newest : null
}
