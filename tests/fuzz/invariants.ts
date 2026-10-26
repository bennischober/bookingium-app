/**
 * I13: the invariant checker.
 *
 * The generator produces ops; this module decides whether the world still makes sense after them. Written
 * fresh for bookingum (nothing copied from the prototype), and shaped by what bookingum's own core exposes:
 * `listOpenOps`, `checkFileConsistency`, `getFolders`, `listMessages`.
 *
 * The four invariants the card requires, and why each is worth a run:
 *
 * - **no message lost or duplicated** after a move or a batch move. A batch UID MOVE (B4) is bookingum's own
 *   path, and the prototype's fuzz never exercised it.
 * - **the local store matches the server** after a resync. Catches a sync that silently drops a folder.
 * - **no op left running** after a run. A stuck `running` op is exactly the MR-01/MR-16 shape: the queue
 *   believes something is in flight forever.
 * - **no orphan files.** Files without a row and rows without a file are both leaks the review calls out.
 */

/** What the checker reads. A plain snapshot, so it is testable without a core. */
export type Snapshot = {
  /** total messages the store holds, across every folder */
  storedMessages: number
  /** per folder: how many the server says, keyed by folder path */
  serverCounts: Record<string, number>
  /** per folder: how many the store holds, keyed by the same paths */
  storedCounts: Record<string, number>
  /** ops still in a non-terminal state */
  openOps: number
  /** file/row consistency from the core's own check */
  files: { rowsWithoutFile: number; filesWithoutRow: number; tmpFiles: number }
}

export type InvariantFailure = {
  invariant: 'no-message-lost-or-duplicated' | 'store-matches-server' | 'no-op-left-running' | 'no-orphan-files'
  detail: string
}

/**
 * Check every invariant against one snapshot.
 *
 * Returns the failures rather than throwing, so a run can report all of them at once instead of stopping at
 * the first - a fuzz that dies on failure 1 hides whether 2 also broke.
 */
export function checkInvariants(snapshot: Snapshot): InvariantFailure[] {
  const failures: InvariantFailure[] = []

  // 1. the store and the server agree per folder. A move that lost a mail shows up as a missing count;
  //    a batch move that duplicated one shows up as an extra.
  for (const [path, serverCount] of Object.entries(snapshot.serverCounts)) {
    const stored = snapshot.storedCounts[path]
    if (stored === undefined) {
      failures.push({
        invariant: 'store-matches-server',
        detail: `folder ${path} has ${serverCount} on the server but no local count`
      })
      continue
    }
    if (stored !== serverCount) {
      failures.push({
        invariant: 'store-matches-server',
        detail: `folder ${path}: server ${serverCount}, store ${stored}`
      })
    }
  }

  // 2. no message lost or duplicated overall: the stored total must equal the sum of the server's.
  const serverTotal = Object.values(snapshot.serverCounts).reduce((a, b) => a + b, 0)
  if (snapshot.storedMessages !== serverTotal) {
    failures.push({
      invariant: 'no-message-lost-or-duplicated',
      detail: `store holds ${snapshot.storedMessages}, the server reports ${serverTotal}`
    })
  }

  // 3. no op left running: after the run settles, a non-terminal op means the queue lost track of it.
  if (snapshot.openOps !== 0) {
    failures.push({
      invariant: 'no-op-left-running',
      detail: `${snapshot.openOps} op(s) are still pending or running after the run settled`
    })
  }

  // 4. no orphan files: a file without a row is a leak, a row without a file is a broken mail.
  if (snapshot.files.filesWithoutRow !== 0) {
    failures.push({
      invariant: 'no-orphan-files',
      detail: `${snapshot.files.filesWithoutRow} file(s) have no row`
    })
  }
  if (snapshot.files.rowsWithoutFile !== 0) {
    failures.push({
      invariant: 'no-orphan-files',
      detail: `${snapshot.files.rowsWithoutFile} row(s) have no file`
    })
  }

  return failures
}

/** The line a failing run prints: the seed and the ops, never any mail content. */
export function failureReport(input: {
  seed: number
  ops: string[]
  failures: InvariantFailure[]
}): string {
  return [
    `FUZZ FAIL seed=${input.seed}`,
    ...input.failures.map((f) => `  ${f.invariant}: ${f.detail}`),
    '  ops:',
    ...input.ops.map((op, i) => `    ${i + 1}. ${op}`),
    `  replay: pnpm fuzz:mail -- --seed ${input.seed}`
  ].join('\n')
}
