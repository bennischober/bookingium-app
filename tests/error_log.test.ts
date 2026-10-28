import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initErrorLog, isExpectedError, logError, scrub } from '../src/main/utils/errorLog'

let dir: string
let minute = 0
// every call in its own minute, so the per-minute cap stays out of the way
const nextMinute = (): number => (minute += 61_000)

function entries(file = 'errors.log'): Record<string, unknown>[] {
  return fs
    .readFileSync(path.join(dir, file), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'errlog-')), 'logs')
  initErrorLog({ folder: dir, version: '1.2.3' })
})

afterEach(() => {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true })
})

describe('error log', () => {
  it('writes one JSON line per error, creating the folder', () => {
    logError('main', new TypeError('x is undefined'), { now: nextMinute() })
    logError('renderer', { message: 'render failed', stack: 'at Page' }, { now: nextMinute() })
    const [first, second] = entries()
    expect(first).toMatchObject({
      source: 'main',
      message: 'TypeError: x is undefined',
      version: '1.2.3'
    })
    expect(String(first.stack)).toContain('x is undefined')
    expect(Number.isNaN(Date.parse(String(first.time)))).toBe(false)
    expect(second).toMatchObject({ source: 'renderer', message: 'render failed', stack: 'at Page' })
    expect(second.fatal).toBeUndefined()
  })

  it('replaces addresses and the home folder and caps the length', () => {
    const home = 'C:\\Users\\tester'
    expect(scrub('login for someone.else@example.test failed', 100, home)).toBe(
      'login for <email> failed'
    )
    expect(
      scrub('at C:\\Users\\tester\\app\\main.js and file:///c:/users/tester/x', 200, home)
    ).toBe('at ~\\app\\main.js and file:///~/x')
    expect(scrub('a'.repeat(50), 10, home)).toBe(`${'a'.repeat(10)}…`)

    logError('mail-core', new Error(`sync error for a@example.test ${'z'.repeat(5_000)}`), {
      now: nextMinute()
    })
    const [entry] = entries()
    expect(entry.message).not.toContain('a@example.test')
    expect(String(entry.message).length).toBeLessThanOrEqual(2_001)
  })

  it('leaves out the failures the app shows as states, unless nothing caught them', () => {
    const offline = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
    const login = Object.assign(new Error('Authentication failed'), { authenticationFailed: true })
    const refused = Object.assign(new Error('Command failed'), { responseStatus: 'NO' })
    for (const error of [offline, login, refused]) expect(isExpectedError(error)).toBe(true)
    expect(isExpectedError(new Error('bug'))).toBe(false)
    expect(isExpectedError('ECONNREFUSED')).toBe(false)

    logError('main', offline, { now: nextMinute() })
    logError('main', login, { now: nextMinute() })
    expect(fs.existsSync(path.join(dir, 'errors.log'))).toBe(false)

    logError('main', offline, { now: nextMinute(), fatal: true })
    expect(entries()).toEqual([
      expect.objectContaining({ code: 'ECONNREFUSED', fatal: true, source: 'main' })
    ])
  })

  it('moves the file on at about 1 MB and keeps three files', () => {
    const big = new Error('y'.repeat(1_900))
    big.stack = 's'.repeat(7_900)
    for (let i = 0; i < 400; i++) logError('main', big, { now: nextMinute() })
    const files = fs.readdirSync(dir).sort()
    expect(files).toEqual(['errors.1.log', 'errors.2.log', 'errors.log'])
    for (const file of files) {
      expect(fs.statSync(path.join(dir, file)).size).toBeLessThanOrEqual(1_000_000)
      // every line is whole after a move
      expect(() => entries(file)).not.toThrow()
    }
    expect(fs.statSync(path.join(dir, 'errors.1.log')).size).toBeGreaterThan(900_000)
  })

  it('writes at most 30 entries a minute and notes how many it skipped', () => {
    const now = nextMinute()
    for (let i = 0; i < 35; i++) logError('renderer', new Error(`loop ${i}`), { now: now + i })
    expect(entries()).toHaveLength(30)

    logError('renderer', new Error('later'), { now: now + 60_000 })
    const lines = entries()
    expect(lines).toHaveLength(32)
    expect(lines[30]).toMatchObject({
      source: 'process',
      message: '5 more error(s) in the previous minute were not logged'
    })
    expect(lines[31]).toMatchObject({ message: 'Error: later' })
  })

  it('never throws when the folder cannot be written', () => {
    const blocked = path.join(path.dirname(dir), 'a-file')
    fs.writeFileSync(blocked, '')
    initErrorLog({ folder: blocked })
    expect(() => logError('main', new Error('lost'), { now: nextMinute() })).not.toThrow()
  })
})
