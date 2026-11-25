// electron-trpc 0.7.1 deserialized an input only when it was truthy, so false, 0, '' and null
// reached the procedures as undefined (a calendar switch could not be turned off again, nor
// backups or the default company). patches/electron-trpc@0.7.1.patch makes it check for
// undefined; this guards against an update that silently drops the patch.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const dist = dirname(require.resolve('electron-trpc/main'))

describe('electron-trpc input handling', () => {
  it.each(['main.cjs', 'main.mjs'])('%s passes falsy inputs through', (file) => {
    const code = readFileSync(join(dist, file), 'utf-8').replace(/\s+/g, '')
    expect(code).toContain('input:g,path:c,id:u}=i.operation,t=g!==void0?')
    expect(code).not.toContain('i.operation,t=g?')
  })
})
