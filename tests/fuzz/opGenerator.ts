/**
 * I13: the mail op generator.
 *
 * Written fresh for bookingum. The prototype's Task 6 fuzz was read for the *idea* only - a seeded op
 * sequence plus invariants - and nothing was copied: this generator drives bookingum's own `MailCore`
 * methods by name, with bookingum's own folders and its own sandbox user, and it knows nothing about the
 * prototype's file layout or its report format.
 *
 * Two properties matter and both are load-bearing:
 *
 * 1. **Seeded.** The same seed always produces the same op list, so a failing run is reproducible from the
 *    seed alone. No `Math.random()` and no clock reads.
 * 2. **Content-free.** An op names kinds and ids (a row id, a folder name, a flag), never a subject, a body
 *    or an address. A failing seed can be pasted into a report or an issue without leaking mail content.
 */

/** What an op does. Kept small on purpose: these are the operations the review names. */
export type OpKind = 'markRead' | 'markUnread' | 'flag' | 'unflag' | 'move' | 'batchMove' | 'trash'

/** One generated operation. Content-free: ids, folder names and flags only. */
export type Op = {
  kind: OpKind
  /** the row ids this op acts on (1 to 3 of them) */
  ids: number[]
  /** for move / batchMove: the target folder name, one of the harness's own folders */
  target?: string
}

/** A tiny deterministic PRNG (mulberry32). Chosen so a seed reproduces a run exactly. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Generate `count` ops for one seed.
 *
 * `ids` are the row ids available at generation time. A move needs a target, so `folders` supplies the
 * harness's own folder names. Both are plain data - the generator never touches the core, which is what
 * makes a seed replayable without a mailbox.
 */
export function generateOps(input: {
  seed: number
  count: number
  ids: number[]
  folders: string[]
}): Op[] {
  const next = rng(input.seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)]
  const ops: Op[] = []

  for (let i = 0; i < input.count; i++) {
    const kind = pick<OpKind>([
      'markRead',
      'markUnread',
      'flag',
      'unflag',
      'move',
      'batchMove',
      'trash'
    ])
    // one id for the single-target ops, up to three for a batch
    const ids =
      kind === 'batchMove'
        ? [...new Set([pick(input.ids), pick(input.ids), pick(input.ids)])]
        : [pick(input.ids)]

    if (kind === 'move' || kind === 'batchMove') {
      ops.push({ kind, ids, target: pick(input.folders) })
    } else {
      ops.push({ kind: kind as OpKind, ids })
    }
  }
  return ops
}

/** A human-readable, content-free rendering of an op - what a failing seed prints. */
export function describeOp(op: Op): string {
  const target = op.target === undefined ? '' : ` -> ${op.target}`
  return `${op.kind} [${op.ids.join(',')}]${target}`
}
