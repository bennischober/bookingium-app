#!/usr/bin/env node
// S1 check for a real mailbox: which stored messages lie above the 5 MB threshold, and whether
// each is stored without its large parts (a skeleton) or whole. Reads the local mail store only,
// read-only, and never contacts a mail server. Run it with the app closed, before and after a
// sync or opening a large message:
//
//   node scripts/mail-s1-counts.mjs
//   node scripts/mail-s1-counts.mjs --dir <userData>/mail/data
//
// Numbers only: no subjects, addresses, file names or bodies are printed. Accounts are shown by
// the first 8 characters of their id (a random UUID).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// same value as LAZY_ABOVE_BYTES in src/main/mailclient/core/sync.ts
const THRESHOLD = 5_000_000
const LIMIT = 20

// node:sqlite warns that it is experimental; the warning says nothing about the store
const emitWarning = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('SQLite')) return
  emitWarning.call(process, warning, ...rest)
}
const { DatabaseSync } = await import('node:sqlite')

function defaultDir() {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'bookingum-app', 'mail', 'data')
}

function argDir() {
  const i = process.argv.indexOf('--dir')
  return i >= 0 ? process.argv[i + 1] : undefined
}

const mb = (bytes) => (bytes / 1e6).toFixed(2)

function fileSize(file) {
  try {
    return fs.statSync(file).size
  } catch {
    return null
  }
}

/** What the row's file says about how it is stored */
function verdict(row, onDisk) {
  if (onDisk === null) return 'file missing'
  if (row.complete === 0)
    return onDisk < row.size_bytes / 2 ? 'skeleton' : 'skeleton, file too large'
  return Math.abs(onDisk - row.size_bytes) <= row.size_bytes * 0.01
    ? 'whole'
    : 'whole, size differs'
}

function report(accountDir, accountId) {
  const db = new DatabaseSync(path.join(accountDir, `${accountId}.db`), { readOnly: true })
  try {
    // a store last opened before S1 has no `complete` column yet; its migration sets 1 on every row
    const migrated = db
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all('messages')
      .some((c) => c.name === 'complete')
    const complete = migrated ? 'complete' : '1 AS complete'
    const total = db.prepare('SELECT count(*) AS n FROM messages').get().n
    const incomplete = migrated
      ? db.prepare('SELECT count(*) AS n FROM messages WHERE complete = 0').get().n
      : 0
    const large = db
      .prepare(
        `SELECT id, size_bytes, ${complete}, flags_json, attachments_json, file_path
         FROM messages WHERE size_bytes > ?${migrated ? ' OR complete = 0' : ''} ORDER BY id DESC`
      )
      .all(THRESHOLD)
    console.log(
      `account ${accountId.slice(0, 8)}: ${total} messages, ${large.length} above ${mb(THRESHOLD)} MB or incomplete, ${incomplete} stored without large parts${migrated ? '' : ' (store not opened since S1 yet)'}`
    )
    if (!large.length) return
    console.log(
      '  row      server MB  file MB  complete  seen  attachments  attachment MB  stored as'
    )
    for (const row of large.slice(0, LIMIT)) {
      const onDisk = fileSize(path.join(accountDir, row.file_path))
      const seen = JSON.parse(row.flags_json).seen === true
      const attachments = JSON.parse(row.attachments_json)
      const attachmentBytes = attachments.reduce((sum, a) => sum + (a.size || 0), 0)
      console.log(
        `  ${String(row.id).padEnd(8)} ${mb(row.size_bytes).padStart(9)}  ${(onDisk === null ? '-' : mb(onDisk)).padStart(7)}  ${String(row.complete).padStart(8)}  ${(seen ? 'yes' : 'no').padStart(4)}  ${String(attachments.length).padStart(11)}  ${mb(attachmentBytes).padStart(13)}  ${verdict(row, onDisk)}`
      )
    }
    if (large.length > LIMIT) console.log(`  ... ${large.length - LIMIT} more`)
  } finally {
    db.close()
  }
}

const dir = argDir() ?? defaultDir()
if (!fs.existsSync(dir)) {
  console.error(`no mail data folder at ${dir} (pass --dir <userData>/mail/data)`)
  process.exitCode = 1
} else {
  const accounts = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, `${d.name}.db`)))
    .map((d) => d.name)
  if (!accounts.length) console.log(`no account stores in ${dir}`)
  for (const id of accounts) report(path.join(dir, id), id)
}
