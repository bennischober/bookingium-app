// I15a (MR-19): the IMAP connections one account may hold at once, shared by the sync
// connection, the IDLE connection and the write connection.
//
// Sync counted its own two (sync + IDLE) and the write engine opened a third outside the cap,
// so production saw three logins where the rule allows two. One budget per account now counts
// all of them. A write is what the user is waiting for, so it asks for a slot as `urgent`:
// holders that registered a yielder (the IDLE connection) are asked to give theirs back, and a
// slot that comes free goes to the urgent waiter first. IDLE comes back once the write
// connection has been idle long enough to close (see WriteConnectionPool).

export type ReleaseSlot = () => void;

export class ConnectionBudget {
  private inUse = 0;
  private urgentWaiting = 0;
  private wakers: (() => void)[] = [];
  private yielders = new Set<() => void>();

  constructor(readonly cap: number) {}

  /** Slots held right now; for tests and diagnostics */
  get used(): number { return this.inUse; }

  /**
   * Take one slot, waiting while all are held. The returned function gives it back and may be
   * called more than once (a failed connect and its 'close' event both release).
   * `cancelled` is polled while waiting, so a stopped engine does not wait forever.
   */
  async acquire(opts: { urgent?: boolean; cancelled?: () => boolean } = {}): Promise<ReleaseSlot> {
    if (opts.urgent) this.urgentWaiting++;
    try {
      while (this.inUse >= this.cap || (!opts.urgent && this.urgentWaiting > 0)) {
        if (opts.cancelled?.()) throw new Error('stopped');
        if (opts.urgent && this.inUse >= this.cap) for (const y of this.yielders) y();
        await this.changed(500);
      }
    } finally {
      if (opts.urgent) this.urgentWaiting--;
    }
    this.inUse++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse--;
      this.wake();
    };
  }

  /** A holder that can give its slot back on request (IDLE); returns the unregister function */
  onYieldRequest(fn: () => void): () => void {
    this.yielders.add(fn);
    return () => this.yielders.delete(fn);
  }

  private changed(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(done, ms);
      timer.unref?.();
      function done() { clearTimeout(timer); resolve(); }
      this.wakers.push(done);
    });
  }

  private wake(): void {
    const wakers = this.wakers;
    this.wakers = [];
    for (const w of wakers) w();
  }
}
