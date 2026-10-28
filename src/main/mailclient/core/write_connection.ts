/**
 * G2/L3c: one write connection, reused across the serialized op chain.
 *
 * Every op used to connect, LOGIN and LOGOUT. Measured on the local sandbox: connect+LOGIN
 * 73 ms and SELECT 31 ms per op with zero network latency; against the real IONOS server a TLS
 * handshake plus LOGIN costs several hundred milliseconds, paid on every click. That is the lag
 * the user reported, so the connection now outlives a single op.
 *
 * Kept out of WriteEngine so the three things that can go wrong are testable without a server:
 *   - it must not reconnect while the connection is healthy,
 *   - a dropped socket must be replaced, not reused (imapflow loses a socket silently on a
 *     server timeout, so a client that looks alive can be dead),
 *   - a failed op must discard the connection rather than hand it to the next op.
 */

/** What the cache needs from a connection; imapflow's `usable` is the liveness signal */
export interface PooledConnection {
  usable: boolean
  logout: () => Promise<unknown>
  /** I15a: one round trip before reuse; a socket that died during sleep does not answer */
  noop: () => Promise<unknown>
  /** I15a: tear the socket down without a LOGOUT (a dead or hung socket would not answer it) */
  close: () => void
}

export interface PoolOptions {
  /** Close the connection after this long without an op, so it gives its slot back (ms) */
  idleMs?: number
  /** How long the NOOP before reuse may take before the connection counts as dead (ms) */
  noopTimeoutMs?: number
}

/** I15a: long enough to keep one connection through a burst of clicks, short enough for IDLE */
export const WRITE_IDLE_MS = 30_000
export const WRITE_NOOP_TIMEOUT_MS = 10_000

export class WriteConnectionPool<T extends PooledConnection> {
  private current: T | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly idleMs: number
  private readonly noopTimeoutMs: number

  constructor(
    private readonly connect: () => Promise<T>,
    options: PoolOptions = {}
  ) {
    this.idleMs = options.idleMs ?? WRITE_IDLE_MS
    this.noopTimeoutMs = options.noopTimeoutMs ?? WRITE_NOOP_TIMEOUT_MS
  }

  /**
   * The connection to use for this op.
   *
   * A connection that reports itself unusable is closed and replaced: reusing a dead socket would
   * turn one server-side timeout into every later op failing. Reconnecting is cheap next to that.
   *
   * I15a (MR-19): `usable` stays true on a socket that died while the laptop slept, and the op
   * then hung until the watchdog stopped the queue. A NOOP with a short deadline goes first; a
   * connection that does not answer it in time is closed and replaced.
   */
  async get(): Promise<T> {
    this.clearIdleTimer()
    const current = this.current
    if (current && current.usable && (await this.answers(current))) return current
    this.current = null
    if (current) closeQuietly(current)
    const fresh = await this.connect()
    this.current = fresh
    return fresh
  }

  /** I15a: the op is over; close the connection unless another op takes it within idleMs */
  idle(): void {
    this.clearIdleTimer()
    if (!this.current) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      void this.drop()
    }, this.idleMs)
    this.idleTimer.unref?.()
  }

  /** Discard the connection, e.g. after an op failed in an unknown way */
  async drop(): Promise<void> {
    this.clearIdleTimer()
    const current = this.current
    this.current = null
    if (current) {
      await current.logout().catch(() => undefined)
      // a LOGOUT that failed leaves the socket open; the slot is given back on close
      closeQuietly(current)
    }
  }

  /** I15a: close at once, without a LOGOUT, when the watchdog abandons an op */
  discard(): void {
    this.clearIdleTimer()
    const current = this.current
    this.current = null
    if (current) closeQuietly(current)
  }

  /** True when a connection is currently held; for tests and diagnostics */
  get held(): boolean {
    return this.current !== null
  }

  private async answers(connection: T): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.noopTimeoutMs)
    })
    try {
      return await Promise.race([
        connection.noop().then(
          () => true,
          () => false
        ),
        deadline
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}

function closeQuietly(connection: PooledConnection): void {
  try {
    connection.close()
  } catch {
    /* already closed: nothing left to release */
  }
}
