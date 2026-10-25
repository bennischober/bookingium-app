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
}

export class WriteConnectionPool<T extends PooledConnection> {
  private current: T | null = null

  constructor(private readonly connect: () => Promise<T>) {}

  /**
   * The connection to use for this op.
   *
   * A connection that reports itself unusable is closed and replaced: reusing a dead socket would
   * turn one server-side timeout into every later op failing. Reconnecting is cheap next to that.
   */
  async get(): Promise<T> {
    const current = this.current
    if (current && current.usable) return current
    this.current = null
    if (current) await current.logout().catch(() => undefined)
    const fresh = await this.connect()
    this.current = fresh
    return fresh
  }

  /** Discard the connection, e.g. after an op failed in an unknown way */
  async drop(): Promise<void> {
    const current = this.current
    this.current = null
    if (current) await current.logout().catch(() => undefined)
  }

  /** True when a connection is currently held; for tests and diagnostics */
  get held(): boolean {
    return this.current !== null
  }
}
