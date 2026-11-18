// ========================================
// Hybrid logical clock
// ========================================
// Every change gets a timestamp that orders it against all others, on every computer the same
// way: wall-clock milliseconds, a counter for changes within the same millisecond (or while the
// clock runs behind one already seen), and the device id as the tiebreak. As a string it sorts
// in that order, so "newer" is a plain string comparison.

export type Hlc = { ms: number; counter: number; device: string }

const MS_DIGITS = 15
const COUNTER_DIGITS = 6

export function formatHlc({ ms, counter, device }: Hlc): string {
  return `${String(ms).padStart(MS_DIGITS, '0')}.${String(counter).padStart(COUNTER_DIGITS, '0')}.${device}`
}

export function parseHlc(value: string): Hlc | null {
  const match = /^(\d{15})\.(\d{6})\.(.+)$/.exec(value)
  if (!match) return null
  return { ms: Number(match[1]), counter: Number(match[2]), device: match[3] }
}

/** The clock of one computer; `last` is the newest timestamp it issued or received */
export class HybridClock {
  private last: Hlc

  constructor(
    private device: string,
    last: string | null,
    private now: () => number = Date.now
  ) {
    this.last = (last && parseHlc(last)) || { ms: 0, counter: 0, device }
  }

  /** A timestamp for a local change, newer than everything seen so far */
  tick(): string {
    const wall = this.now()
    if (wall > this.last.ms) this.last = { ms: wall, counter: 0, device: this.device }
    else this.last = { ms: this.last.ms, counter: this.last.counter + 1, device: this.device }
    return formatHlc(this.last)
  }

  /** Takes in a timestamp from another computer, so later local ones sort after it */
  receive(value: string): void {
    const remote = parseHlc(value)
    if (!remote) return
    if (
      remote.ms > this.last.ms ||
      (remote.ms === this.last.ms && remote.counter > this.last.counter)
    )
      this.last = { ms: remote.ms, counter: remote.counter, device: this.device }
  }

  current(): string {
    return formatHlc(this.last)
  }
}
