// I13: the fuzz harness's own tests.
//
// The harness is only worth a nightly run if its parts are correct: a generator that is not reproducible makes
// a failing seed useless, and an invariant checker that cannot fail proves nothing. Both are pure, so they are
// tested here; the runner itself needs the sandbox and is exercised by `pnpm fuzz:mail`.
import { describe, expect, it } from 'vitest'
import { describeOp, generateOps } from './fuzz/opGenerator'
import { checkInvariants, failureReport, type Snapshot } from './fuzz/invariants'

const base: Snapshot = {
  storedMessages: 3,
  serverCounts: { FuzzA: 2, FuzzB: 1 },
  storedCounts: { FuzzA: 2, FuzzB: 1 },
  openOps: 0,
  files: { rowsWithoutFile: 0, filesWithoutRow: 0, tmpFiles: 0 }
}

describe('I13: the op generator is reproducible and content-free', () => {
  it('produces the same ops for the same seed', () => {
    // A failing run must be replayable from the seed alone
    const input = { seed: 7, count: 20, ids: [1, 2, 3], folders: ['FuzzA', 'FuzzB'] }
    expect(generateOps(input)).toEqual(generateOps(input))
  })

  it('produces different ops for a different seed', () => {
    const a = generateOps({ seed: 7, count: 20, ids: [1, 2, 3], folders: ['FuzzA'] })
    const b = generateOps({ seed: 8, count: 20, ids: [1, 2, 3], folders: ['FuzzA'] })
    expect(a).not.toEqual(b)
  })

  it('generates exactly the requested number of ops', () => {
    expect(generateOps({ seed: 1, count: 30, ids: [1], folders: ['FuzzA'] })).toHaveLength(30)
  })

  it('never puts mail content in an op', () => {
    // The op list is what a failing seed prints; a subject or a body in it would leak mail into a report
    const ops = generateOps({ seed: 3, count: 40, ids: [1, 2], folders: ['FuzzA'] })
    for (const op of ops) {
      const rendered = describeOp(op)
      expect(rendered).toMatch(/^[a-zA-Z]+ \[[0-9,]+\]( -> FuzzA)?$/)
    }
  })

  it('gives a move a target from the folders it was handed', () => {
    const ops = generateOps({ seed: 5, count: 60, ids: [1], folders: ['FuzzA', 'FuzzB'] })
    const moves = ops.filter((op) => op.kind === 'move' || op.kind === 'batchMove')
    expect(moves.length).toBeGreaterThan(0)
    for (const move of moves) expect(['FuzzA', 'FuzzB']).toContain(move.target)
  })

  it('de-duplicates the ids of a batch move', () => {
    // the same id twice in one batch would ask the core to move one mail twice
    const ops = generateOps({ seed: 11, count: 80, ids: [1], folders: ['FuzzA'] })
    for (const op of ops.filter((o) => o.kind === 'batchMove')) {
      expect(new Set(op.ids).size).toBe(op.ids.length)
    }
  })
})

describe('I13: the invariant checker can fail', () => {
  it('accepts a consistent snapshot', () => {
    expect(checkInvariants(base)).toEqual([])
  })

  it('catches a lost or duplicated message', () => {
    // the card's first invariant
    const failures = checkInvariants({ ...base, storedMessages: 4 })
    expect(failures.map((f) => f.invariant)).toContain('no-message-lost-or-duplicated')
  })

  it('catches a folder whose local count drifted from the server', () => {
    const failures = checkInvariants({ ...base, storedCounts: { FuzzA: 1, FuzzB: 1 } })
    expect(failures.map((f) => f.invariant)).toContain('store-matches-server')
  })

  it('catches a folder the store does not know at all', () => {
    const failures = checkInvariants({ ...base, storedCounts: {} })
    expect(failures.some((f) => f.invariant === 'store-matches-server')).toBe(true)
  })

  it('catches an op left running', () => {
    const failures = checkInvariants({ ...base, openOps: 1 })
    expect(failures.map((f) => f.invariant)).toContain('no-op-left-running')
  })

  it('catches an orphan file in both directions', () => {
    const a = checkInvariants({ ...base, files: { rowsWithoutFile: 0, filesWithoutRow: 2, tmpFiles: 0 } })
    expect(a.map((f) => f.invariant)).toContain('no-orphan-files')
    const b = checkInvariants({ ...base, files: { rowsWithoutFile: 1, filesWithoutRow: 0, tmpFiles: 0 } })
    expect(b.map((f) => f.invariant)).toContain('no-orphan-files')
  })

  it('reports every failure at once, not only the first', () => {
    // a run that dies on failure 1 hides whether 2 also broke
    const failures = checkInvariants({
      ...base,
      storedMessages: 9,
      // a drifted folder count too, or store-matches-server has nothing to object to
      storedCounts: { FuzzA: 5, FuzzB: 1 },
      openOps: 2,
      files: { rowsWithoutFile: 1, filesWithoutRow: 1, tmpFiles: 0 }
    })
    expect(new Set(failures.map((f) => f.invariant)).size).toBe(4)
  })
})

describe('I13: a failing seed prints the seed and the ops, never content', () => {
  it('names the seed, the invariant and a replay command', () => {
    const report = failureReport({
      seed: 33,
      ops: ['move [1] -> FuzzA', 'trash [2]'],
      failures: [{ invariant: 'no-op-left-running', detail: '1 op(s) are still pending' }]
    })
    expect(report).toContain('seed=33')
    expect(report).toContain('move [1] -> FuzzA')
    expect(report).toContain('pnpm fuzz:mail -- --seed 33')
    expect(report).toContain('no-op-left-running')
  })
})
