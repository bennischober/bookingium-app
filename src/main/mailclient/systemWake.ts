// Tells the mail worker that the machine woke from sleep, so it drops the sockets that may have
// died meanwhile and catches up (MailCore.afterSystemResume). Electron's power monitor reports a
// resume; a late clock tick covers the sleeps it misses (Windows Modern Standby throttles the app
// instead of suspending it). After a wake the signal waits a while for the network, which comes
// back seconds after the machine does, and a burst of signals counts once.
// Kept free of Electron (index.ts passes powerMonitor and net in) so it is testable on fake timers.

export interface WakeSources {
  /** Electron's powerMonitor 'resume' */
  onResume: (listener: () => void) => void
  /** Electron's net.isOnline() */
  isOnline: () => boolean
}

/** How often the clock is checked */
export const WAKE_CHECK_MS = 30_000
/** A check this much later than due means the machine was asleep */
export const WAKE_LATE_MS = 120_000
/** Further signals within this long of a wake count as the same wake */
export const WAKE_COALESCE_MS = 60_000
/** While offline after a wake: how often to look, and how long at most before reporting anyway */
export const WAKE_ONLINE_POLL_MS = 2_000
export const WAKE_ONLINE_WAIT_MS = 60_000

/** Calls `onWake` once per wake; returns a function that stops watching */
export function watchSystemWake(onWake: () => void, sources: WakeSources): () => void {
  let lastWake = -Infinity
  let waiting: ReturnType<typeof setInterval> | null = null

  const wake = (): void => {
    if (waiting || Date.now() - lastWake < WAKE_COALESCE_MS) return
    lastWake = Date.now()
    if (sources.isOnline()) {
      onWake()
      return
    }
    // Still offline: report once the network is back, or after the wait; offline the worker's
    // own retry takes over, but the dead sockets are dropped either way
    const giveUpAt = Date.now() + WAKE_ONLINE_WAIT_MS
    const timer = setInterval(() => {
      if (!sources.isOnline() && Date.now() < giveUpAt) return
      clearInterval(timer)
      waiting = null
      onWake()
    }, WAKE_ONLINE_POLL_MS)
    waiting = timer
  }

  sources.onResume(wake)
  let lastTick = Date.now()
  const clock = setInterval(() => {
    const now = Date.now()
    if (now - lastTick > WAKE_CHECK_MS + WAKE_LATE_MS) wake()
    lastTick = now
  }, WAKE_CHECK_MS)
  clock.unref?.()

  return () => {
    clearInterval(clock)
    if (waiting) clearInterval(waiting)
    waiting = null
  }
}
