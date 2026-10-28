import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * The local error log: real bugs only, never ordinary activity.
 *
 * One JSON object per line in `<userData>/logs/errors.log`. At about 1 MB the file moves to
 * `errors.1.log` (and that one to `errors.2.log`), so at most three files exist. Nothing is
 * uploaded; the user opens the folder from Einstellungen › Daten and sends what they choose.
 *
 * What lands here: crashes and errors nothing caught (main process, mail worker, renderer), a
 * render error a boundary caught, and the mail core's `log.error`. Expected failures the app
 * already shows the user (offline, a rejected login, a server that refuses a command) stay out,
 * unless they crashed something. Every text is scrubbed: e-mail addresses and the home folder are
 * replaced and lengths are capped. Callers pass errors, never mail content.
 *
 * Writes are synchronous so an entry lands before a crashing process exits, and nothing in here
 * throws: a log that cannot be written is silently skipped.
 */

export type ErrorSource = 'main' | 'renderer' | 'mail-worker' | 'mail-core' | 'process'

export interface ErrorEntry {
  time: string
  source: ErrorSource
  message: string
  stack?: string
  code?: string
  fatal?: true
  version?: string
}

const FILE = 'errors.log'
const MAX_BYTES = 1_000_000
// errors.log, errors.1.log, errors.2.log
const KEEP = 3
const MAX_MESSAGE = 2_000
const MAX_STACK = 8_000
// a render loop or a failing timer must not push every earlier entry out of the files
const MAX_PER_MINUTE = 30

// Bounded like an address (RFC 5321 limits), so a long run of word characters in a stack cannot
// make the scan quadratic
const EMAIL = /[\w.%+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){0,8}\.[a-z]{2,24}/gi
// an address is at most this long, so cutting the text here first cannot leave half of one
const ADDRESS_MAX = 320

// Connection, login and server refusals the app already reports as states, not bugs
const EXPECTED_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'NoConnection'
])

let folder: string | null = null
let version: string | undefined
let windowStart = 0
let inWindow = 0
let dropped = 0

export function initErrorLog(options: { folder: string; version?: string }): void {
  folder = options.folder
  version = options.version
  windowStart = 0
  inWindow = 0
  dropped = 0
}

/** The folder the log files live in, created if needed; null before initErrorLog */
export function errorLogFolder(): string | null {
  if (!folder) return null
  fs.mkdirSync(folder, { recursive: true })
  return folder
}

/** Offline, a rejected login or a server's NO/BAD: shown to the user, not a bug */
export function isExpectedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as {
    code?: unknown
    authenticationFailed?: unknown
    responseStatus?: unknown
    name?: unknown
  }
  if (e.name === 'AbortError') return true
  if (e.authenticationFailed === true) return true
  if (e.responseStatus === 'NO' || e.responseStatus === 'BAD') return true
  return typeof e.code === 'string' && EXPECTED_CODES.has(e.code)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Addresses and the user's home folder out, length capped */
export function scrub(text: string, max: number, home = os.homedir()): string {
  let out = text.slice(0, max + ADDRESS_MAX).replace(EMAIL, '<email>')
  if (home) {
    for (const form of new Set([home, home.replace(/\\/g, '/')])) {
      out = out.replace(new RegExp(escapeRegExp(form), 'gi'), '~')
    }
  }
  return out.length > max ? `${out.slice(0, max)}…` : out
}

function describe(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return {
      message: `${error.name}: ${error.message}`,
      stack: error.stack,
      code: typeof code === 'string' ? code : undefined
    }
  }
  if (typeof error === 'object' && error !== null) {
    const { message, stack } = error as { message?: unknown; stack?: unknown }
    if (typeof message === 'string') {
      return { message, stack: typeof stack === 'string' ? stack : undefined }
    }
  }
  if (typeof error === 'string') return { message: error }
  try {
    return { message: JSON.stringify(error) ?? String(error) }
  } catch {
    return { message: String(error) }
  }
}

function numbered(dir: string, n: number): string {
  return path.join(dir, n === 0 ? FILE : `errors.${n}.log`)
}

function rotate(dir: string): void {
  for (let n = KEEP - 1; n >= 1; n--) {
    const from = numbered(dir, n - 1)
    if (fs.existsSync(from)) fs.renameSync(from, numbered(dir, n))
  }
}

function append(dir: string, entry: ErrorEntry): void {
  const line = `${JSON.stringify(entry)}\n`
  const file = numbered(dir, 0)
  let size = 0
  try {
    size = fs.statSync(file).size
  } catch {
    // no file yet
  }
  if (size > 0 && size + Buffer.byteLength(line) > MAX_BYTES) rotate(dir)
  fs.appendFileSync(file, line)
}

/**
 * Record an error. `fatal` marks an error nothing caught, or a process that died: it is written
 * even when the error is one of the expected kinds, since nothing handled it.
 */
export function logError(
  source: ErrorSource,
  error: unknown,
  options: { fatal?: boolean; now?: number } = {}
): void {
  try {
    if (!folder) return
    if (!options.fatal && isExpectedError(error)) return
    const now = options.now ?? Date.now()
    if (now - windowStart >= 60_000) {
      if (dropped > 0) {
        append(errorLogFolder() ?? folder, {
          time: new Date(now).toISOString(),
          source: 'process',
          message: `${dropped} more error(s) in the previous minute were not logged`
        })
      }
      windowStart = now
      inWindow = 0
      dropped = 0
    }
    if (inWindow >= MAX_PER_MINUTE) {
      dropped++
      return
    }
    inWindow++
    const { message, stack, code } = describe(error)
    const entry: ErrorEntry = {
      time: new Date(now).toISOString(),
      source,
      message: scrub(message, MAX_MESSAGE)
    }
    if (stack) entry.stack = scrub(stack, MAX_STACK)
    if (code) entry.code = code
    if (options.fatal) entry.fatal = true
    if (version) entry.version = version
    append(errorLogFolder() ?? folder, entry)
  } catch {
    // the log must never be the thing that fails
  }
}
