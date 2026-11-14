// #157: adaptive pacing of the sync connection's paced loops (the STATUS census, the flag sweep's
// 500-UID chunks, the download batches), in place of the fixed pauses from the prototype.
//
// Commands on one connection are already sequential (each waits for its answer), so the server's
// own latency paces us; a pause only helps against a server that counts commands per time window.
// So the pause starts at the account's floor (0 for the census and the sweep) and grows only on a
// throttling signal, AIMD-style:
//   - multiplicative back-off: a tagged NO/BAD with [LIMIT], [UNAVAILABLE] or [INUSE] (RFC 5530),
//     imapflow's ETHROTTLE (Office 365's "Request is throttled"), BYE or a lost connection, or an
//     answer far slower than the connection's median: the adaptive part doubles, at most 2 s;
//   - additive-ish recovery: every few normal answers it shrinks by a fifth, down to 0.
// Latency is read only from commands of even size (STATUS, a flag chunk), never from downloads,
// and only above an absolute floor, so Wi-Fi or VPN jitter on a fast server is not throttling.
// The circuit breaker (sync_connection.ts) stays the last resort.
//
// One pacer per SyncEngine, i.e. per account's sync connection: IDLE sends nothing paced, and the
// write engine's commands are the user's own. The adaptive part is remembered in the store (kv),
// a learned hint and not a setting, so the next start begins where the last one ended.

/** The paced loops; each has its own floor, the adaptive part is shared. */
export type PaceKind = 'census' | 'sweep' | 'batch';

/** What made the pacer back off. */
export type ThrottleSignal = 'limit' | 'bye' | 'disconnect' | 'slow';

export const PACER_TUNING = {
  /** the adaptive part never grows past this */
  capMs: 2000,
  /** the first back-off from 0 */
  firstStepMs: 100,
  /** this many normal answers in a row shrink the adaptive part once */
  recoverEvery: 5,
  recoverFactor: 0.8,
  /** below this the adaptive part is 0 again */
  zeroBelowMs: 10,
  /** an answer slower than this many times the median is a signal ... */
  slowFactor: 3,
  /** ... when it is also slower than this, whatever the median */
  slowMinMs: 750,
  /** latencies kept for the median, and how many it needs first */
  samples: 31,
  minSamples: 8,
} as const;

/** The pacer's facts for one pass, for the pass summary. */
export type PacerStats = {
  /** the adaptive part at the end of the pass, in ms */
  pauseMs: number;
  /** the highest adaptive part during the pass, in ms */
  maxPauseMs: number;
  /** throttling signals during the pass */
  signals: number;
};

/** The RFC 5530 response codes that mean "slow down" (or "come back later"). */
const THROTTLE_CODES = new Set(['LIMIT', 'UNAVAILABLE', 'INUSE']);

/** The response code of an imapflow error (`NO [LIMIT] ...` -> 'LIMIT'), or null. */
function responseCodeOf(e: unknown): string | null {
  const attrs = (e as { response?: { attributes?: unknown[] } } | null)?.response?.attributes;
  const first = Array.isArray(attrs) ? attrs[0] as { section?: { value?: unknown }[] } | undefined : undefined;
  const code = first?.section?.[0]?.value;
  if (typeof code === 'string') return code.toUpperCase();
  // a server's text may carry it too, e.g. after a proxy rewrote the answer
  const text = (e as { responseText?: unknown } | null)?.responseText;
  const m = typeof text === 'string' ? text.match(/^\[([A-Z-]+)\]/i) : null;
  return m ? m[1].toUpperCase() : null;
}

/**
 * The throttling signal an error of an IMAP command carries, or null for an ordinary failure
 * (a folder that is gone, a refused SELECT): those are not the server asking us to slow down.
 */
export function throttleSignalOf(e: unknown): ThrottleSignal | null {
  const err = e as { code?: unknown; responseStatus?: unknown } | null;
  if (!err || typeof err !== 'object') return null;
  if (err.code === 'ETHROTTLE') return 'limit';
  if (err.responseStatus === 'BYE') return 'bye';
  const code = responseCodeOf(e);
  if (code && THROTTLE_CODES.has(code)) return 'limit';
  if (err.code === 'NoConnection' || err.code === 'EConnectionClosed') return 'disconnect';
  return null;
}

/** The kv key the learned pause is remembered under. */
export const PACER_KV_KEY = 'pacer_pause_ms';

/** A remembered pause as the store has it: a whole number of ms within the cap, else 0. */
export function parseRememberedPause(value: string | null): number {
  if (!value || !/^\d{1,4}$/.test(value)) return 0;
  return Math.min(Number(value), PACER_TUNING.capMs);
}

export class Pacer {
  private adaptiveMs: number;
  private latencies: number[] = [];
  private normalRun = 0;
  private passMax: number;
  private passSignals = 0;
  /** errors already read: imapflow may log an error it also throws */
  private readonly seen = new WeakSet<object>();
  /** all signals since the engine started, by kind (tests and diagnostics) */
  readonly signalCounts: Record<ThrottleSignal, number> = { limit: 0, bye: 0, disconnect: 0, slow: 0 };

  constructor(
    /** the fixed floor of each loop: the account's setting, or the host's override */
    private readonly floors: Record<PaceKind, number>,
    startMs = 0,
    /** called when the adaptive part changed, to remember it */
    private readonly onChange: (adaptiveMs: number) => void = () => undefined,
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
    private readonly now: () => number = Date.now,
  ) {
    this.adaptiveMs = Math.max(0, Math.min(startMs, PACER_TUNING.capMs));
    this.passMax = this.adaptiveMs;
  }

  /** The adaptive part, in ms: what the pacer learned on top of the floors. */
  get currentMs(): number { return this.adaptiveMs; }

  /** The pause a loop of this kind waits now: its floor plus the adaptive part. */
  pauseFor(kind: PaceKind): number {
    return this.floors[kind] + this.adaptiveMs;
  }

  /** Waits the pause of this kind (after a command, before the next one). */
  async pace(kind: PaceKind): Promise<void> {
    const ms = this.pauseFor(kind);
    if (ms > 0) await this.sleep(ms);
  }

  /**
   * Runs one command of even size (a STATUS, a flag chunk) and reads its answer: the time it
   * took, or the throttling signal its error carries. The error is rethrown. imapflow's STATUS
   * answers a refusal with `false` instead of throwing; that is no answer to time.
   */
  async timed<T>(command: () => Promise<T>): Promise<T> {
    const t0 = this.now();
    try {
      const result = await command();
      if (result !== false) this.answered(this.now() - t0);
      return result;
    } catch (e) {
      this.failed(e);
      throw e;
    }
  }

  /** A command failed: a throttling signal backs off, any other failure leaves the pace alone. */
  failed(e: unknown): void {
    if (e && typeof e === 'object') {
      if (this.seen.has(e)) return;
      this.seen.add(e);
    }
    const signal = throttleSignalOf(e);
    if (signal) this.signal(signal);
  }

  /** An answer came after `ms`: far slower than usual is a signal, else it counts as normal. */
  answered(ms: number): void {
    const t = PACER_TUNING;
    const slow = this.latencies.length >= t.minSamples && ms >= t.slowMinMs && ms > t.slowFactor * this.median();
    this.latencies.push(ms);
    if (this.latencies.length > t.samples) this.latencies.shift();
    if (slow) { this.signal('slow'); return; }
    this.normal();
  }

  /** An answer without a latency worth reading (a download batch): counts as normal. */
  normal(): void {
    const t = PACER_TUNING;
    if (this.adaptiveMs === 0) return;
    if (++this.normalRun < t.recoverEvery) return;
    this.normalRun = 0;
    const next = Math.floor(this.adaptiveMs * t.recoverFactor);
    this.set(next < t.zeroBelowMs ? 0 : next);
  }

  /** The server asked us to slow down: double the adaptive part, at most the cap. */
  signal(kind: ThrottleSignal): void {
    const t = PACER_TUNING;
    this.signalCounts[kind]++;
    this.passSignals++;
    this.normalRun = 0;
    this.set(Math.min(t.capMs, this.adaptiveMs > 0 ? this.adaptiveMs * 2 : t.firstStepMs));
  }

  /** A pass starts: its stats count from here. */
  beginPass(): void {
    this.passMax = this.adaptiveMs;
    this.passSignals = 0;
  }

  /** The pass's stats so far. */
  passStats(): PacerStats {
    return { pauseMs: this.adaptiveMs, maxPauseMs: this.passMax, signals: this.passSignals };
  }

  private median(): number {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  private set(ms: number): void {
    if (ms === this.adaptiveMs) return;
    this.adaptiveMs = ms;
    this.passMax = Math.max(this.passMax, ms);
    try { this.onChange(ms); } catch { /* remembering is a hint; pacing goes on without it */ }
  }
}
