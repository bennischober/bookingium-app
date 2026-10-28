/**
 * I13: the fuzz runner - drives bookingum's OWN core against the sandbox.
 *
 * Run it with `pnpm fuzz:mail -- --seed 7 --ops 30` (or `--seeds 50` for a batch). It is deliberately NOT a
 * `.test.ts`, so `pnpm test` never picks it up: the card requires a separate script, and a nightly fuzz must not
 * slow the pre-commit gate.
 *
 * It uses its OWN sandbox user and its own folders, like the e2e suite does, so it never shares a mailbox (or the
 * per-user connection limit) with the tests or with another harness. Everything it creates is removed again.
 *
 * Content-free by construction: the op generator and the report name kinds, ids and folder names only. No subject,
 * body or address is read, printed or stored anywhere in this file.
 */
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { createMailCore, type MailCore } from '../../src/main/mailclient/core/index'
import { generateOps, describeOp, type Op } from './opGenerator'
import { checkInvariants, failureReport, type Snapshot } from './invariants'

const HOST = '127.0.0.1'
const PORT = 10143
const USER = 'bookingum-fuzz@example.test'
const PASS = 'testpass'
/** The harness's own folders, so it never touches INBOX or another run's work */
const FOLDERS = ['FuzzA', 'FuzzB', 'FuzzC']
const SUBJECT_PREFIX = 'bookingum-fuzz-'

type Args = { seed?: number; seeds?: number; ops: number }

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag)
    return at === -1 ? undefined : argv[at + 1]
  }
  const seed = get('--seed')
  const seeds = get('--seeds')
  return {
    seed: seed === undefined ? undefined : Number(seed),
    seeds: seeds === undefined ? undefined : Number(seeds),
    ops: Number(get('--ops') ?? 30)
  }
}

function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port, timeout: 1000 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

/** A scratch data dir for the run's core; removed at the end. */
function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-fuzz-'))
}

/**
 * One run: build a core on a fresh data dir, seed its own folders with a few mails, apply the generated ops,
 * resync, then check the invariants.
 *
 * The snapshot is read from the core's own public surface - `getFolders` for the per-folder counts,
 * `listOpenOps` for the journal, `checkFileConsistency` for the files - so the checker measures what the app
 * itself believes, not a second opinion built in the harness.
 */
async function runOnce(
  seed: number,
  opCount: number
): Promise<{ seed: number; ops: Op[]; failures: ReturnType<typeof checkInvariants> }> {
  const dir = scratchDir()
  let core: MailCore | null = null
  try {
    core = createMailCore({
      dataDir: dir,
      accounts: [
        {
          id: 'fuzz',
          readOnly: false,
          host: HOST,
          port: PORT,
          security: 'none',
          user: USER,
          pass: PASS,
          email: USER,
          credentials: () => Promise.resolve({ user: USER, pass: PASS })
        }
      ],
      log: {}
    })

    // The harness's own folders, created on the server by the sync engine
    for (const folder of FOLDERS) {
      await core.createFolder(null, folder).catch(() => undefined)
    }
    await core.triggerSync(true)

    const folders = await core.getFolders()
    const own = folders.filter((f) => FOLDERS.includes(f.path))
    const first = own[0]
    if (!first) throw new Error('the fuzz folders were not created - is the sandbox writable?')

    // Seed a few mails of our own INTO the harness folder. A draft would land in Drafts, which is not the
    // folder the ops act on, so the mail is appended straight to the folder through IMAP - the same way the
    // e2e suite seeds its own mail.
    await seedFolder(FOLDERS[0], seed)
    await core.triggerSync(true)

    const listed = await core.listMessages(first.id, { offset: 0, limit: 20 })
    const ids = listed.map((m) => m.id)
    if (ids.length === 0) throw new Error('no seeded mails to act on')

    const ops = generateOps({ seed, count: opCount, ids, folders: FOLDERS })
    for (const op of ops) await applyOp(core, op)

    // Let the journal settle before judging it: a pending op that the queue is still working on is not a leak
    await core.triggerSync(true)

    const snapshot = await takeSnapshot(core)
    return { seed, ops, failures: checkInvariants(snapshot) }
  } finally {
    if (core) await core.close().catch(() => undefined)
    // The sandbox is left as it was found
    for (const folder of FOLDERS) {
      await removeServerFolder(folder).catch(() => undefined)
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Apply one generated op through the core's own API. */
async function applyOp(core: MailCore, op: Op): Promise<void> {
  switch (op.kind) {
    case 'markRead':
      await core.markRead(op.ids, true).catch(() => undefined)
      return
    case 'markUnread':
      await core.markRead(op.ids, false).catch(() => undefined)
      return
    case 'flag':
      await core.markFlagged(op.ids, true).catch(() => undefined)
      return
    case 'unflag':
      await core.markFlagged(op.ids, false).catch(() => undefined)
      return
    case 'trash':
      await core.deleteToTrash(op.ids).catch(() => undefined)
      return
    case 'move':
    case 'batchMove': {
      const folders = await core.getFolders()
      const target = folders.find((f) => f.path === op.target)
      if (target) await core.moveToFolder(op.ids, target.id).catch(() => undefined)
      return
    }
  }
}

/** The four invariants, read from the core's own surfaces. */
async function takeSnapshot(core: MailCore): Promise<Snapshot> {
  const folders = await core.getFolders()
  const serverCounts: Record<string, number> = {}
  const storedCounts: Record<string, number> = {}
  let storedMessages = 0
  for (const folder of folders) {
    // `totalCount` is the store's own count per folder; the server side comes from a fresh sync below
    storedCounts[folder.path] = folder.totalCount
    storedMessages += folder.totalCount
  }
  // A resync, then the server's own per-folder counts
  await core.triggerSync(true)
  for (const folder of await core.getFolders()) {
    serverCounts[folder.path] = folder.totalCount
  }
  const open = await core.listOpenOps()
  return {
    storedMessages,
    serverCounts,
    storedCounts,
    openOps: open.filter((op) => op.state === 'pending' || op.state === 'running').length,
    files: core.checkFileConsistency()
  }
}

/** Appends a few content-free mails into the harness's own folder, so the ops have something to act on. */
async function seedFolder(folder: string, seed: number): Promise<void> {
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false
  })
  await client.connect()
  try {
    for (let i = 0; i < 6; i++) {
      // the subject is the harness's own marker plus numbers - no real content anywhere
      const raw = Buffer.from(
        [
          `From: ${USER}`,
          `To: ${USER}`,
          `Subject: ${SUBJECT_PREFIX}${seed}-${i}`,
          `Message-ID: <${SUBJECT_PREFIX}${seed}-${i}@example.test>`,
          '',
          'fuzz',
          ''
        ].join('\r\n')
      )
      await client.append(folder, raw, [])
    }
  } finally {
    await client.logout().catch(() => client.close())
  }
}

/** Removes one folder on the server, so the sandbox keeps no trace of the run. */
async function removeServerFolder(folder: string): Promise<void> {
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false
  })
  await client.connect()
  try {
    const exists = (await client.list()).some((b) => b.path === folder)
    if (exists) await client.mailboxDelete(folder)
  } finally {
    await client.logout().catch(() => client.close())
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!(await reachable(PORT))) {
    console.error(
      `the mail sandbox is not reachable on ${HOST}:${PORT} - start the Dovecot container`
    )
    process.exit(2)
  }

  const seeds =
    args.seed !== undefined ? [args.seed] : Array.from({ length: args.seeds ?? 1 }, (_, i) => i + 1)
  let failed = 0
  let totalOps = 0

  for (const seed of seeds) {
    const result = await runOnce(seed, args.ops)
    totalOps += result.ops.length
    if (result.failures.length > 0) {
      failed++
      // The seed and the op list, never any content - this is the line a report or issue carries
      console.error(
        failureReport({ seed, ops: result.ops.map(describeOp), failures: result.failures })
      )
    }
  }

  console.log(
    `fuzz: ${seeds.length} seed(s), ${totalOps} op(s), ${failed} seed(s) with invariant failures`
  )
  process.exit(failed === 0 ? 0 : 1)
}

void main()
