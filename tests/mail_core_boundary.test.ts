// A8: the core's boundary contract, ported from the prototype's test-core-boundary.
// The mail core must stay free of Electron, process.env reads and HTTP/browser imports, and
// two cores on one data dir must be impossible.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMailCore, type MailCore } from '../src/main/mailclient/core/index'
import { InstanceLockError } from '../src/main/mailclient/core/instance_lock'

const CORE_DIR = path.resolve(__dirname, '../src/main/mailclient/core')

const cleanups: (() => void)[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!
    try {
      await fn()
    } catch {
      /* best effort */
    }
  }
})

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-boundary-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const mkOptions = (dataDir: string) => ({
  dataDir,
  accounts: [
    {
      id: 'boundary',
      kind: 'sandbox' as const,
      host: '127.0.0.1',
      port: 10199, // deliberately unreachable: no server contact in this test
      security: 'none' as const,
      user: 'testuser@example.test',
      pass: 'testpass'
    }
  ],
  sandbox: {
    imapHost: '127.0.0.1',
    imapPort: 10143,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    user: 'u',
    pass: 'p'
  }
})

describe('core boundary: instance lock', () => {
  it('refuses a second core on the same data dir, naming the holder pid', () => {
    const dir = scratchDir()
    const first = createMailCore(mkOptions(dir))
    cleanups.push(() => first.close())

    let error: unknown = null
    try {
      createMailCore(mkOptions(dir))
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(InstanceLockError)
    expect((error as InstanceLockError).lockInfo?.pid).toBe(process.pid)
  })

  it('keeps the lock file inside the data dir and removes it on close()', async () => {
    const dir = scratchDir()
    const core = createMailCore(mkOptions(dir))
    const lockFile = path.join(dir, '.mailcore.lock')
    expect(fs.existsSync(lockFile)).toBe(true)

    await core.close()

    expect(fs.existsSync(lockFile)).toBe(false)
    // ... and a second core can take it afterwards
    const again: MailCore = createMailCore(mkOptions(dir))
    cleanups.push(() => again.close())
  })
})

describe('core boundary: static rules', () => {
  const files = fs.readdirSync(CORE_DIR).filter((f) => f.endsWith('.ts'))

  it('has no process.env read in the core', () => {
    const hits: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(path.join(CORE_DIR, f), 'utf8')
      src.split('\n').forEach((line, i) => {
        // comments may talk about the rule; only real accesses count
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (/process\.env[.[]/.test(line)) hits.push(`${f}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('imports no Electron, HTTP server or browser client from the core', () => {
    const hits: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(path.join(CORE_DIR, f), 'utf8')
      for (const m of src.matchAll(/from ['"]([^'"]+)['"]/g)) {
        const target = m[1]
        const forbidden =
          target === 'electron' ||
          /^electron\//.test(target) ||
          /^node:http/.test(target) ||
          /^(\.\.\/)+(server|client)\//.test(target)
        if (forbidden) hits.push(`${f} -> ${target}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('keeps its imports inside the core (no upward relative imports)', () => {
    const hits: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(path.join(CORE_DIR, f), 'utf8')
      for (const m of src.matchAll(/from ['"]([^'"]+)['"]/g)) {
        const target = m[1]
        // A core file may import a sibling; going up one level leaves the core
        if (/^\.\.\//.test(target)) hits.push(`${f} -> ${target}`)
      }
    }
    expect(hits).toEqual([])
  })
})
