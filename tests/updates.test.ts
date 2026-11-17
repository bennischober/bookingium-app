// #49 Auto-update: the status the settings card shows for electron-updater's events, and the
// release contract (electron-builder publishes to GitHub metadata the release workflow uploads).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  initialUpdateStatus,
  nextUpdateStatus,
  updateErrorMessage,
  type UpdateEvent
} from '../src/main/updates/state'

const run = (events: UpdateEvent[], supported = true) =>
  events.reduce(nextUpdateStatus, initialUpdateStatus('1.0.0', supported))

describe('update status', () => {
  it('goes from checking over downloading to ready', () => {
    const status = run([
      { type: 'checking', at: 't1' },
      { type: 'available', version: '1.1.0' },
      { type: 'progress', percent: 42.6 },
      { type: 'downloaded', version: '1.1.0' }
    ])
    expect(status).toMatchObject({
      phase: 'ready',
      version: '1.1.0',
      percent: 100,
      lastCheckAt: 't1'
    })
  })

  it('reports up to date when nothing is newer', () => {
    expect(
      run([
        { type: 'checking', at: 't' },
        { type: 'not-available', at: 't' }
      ]).phase
    ).toBe('current')
  })

  it('keeps a downloaded update ready through later checks and errors', () => {
    const ready = run([
      { type: 'available', version: '1.1.0' },
      { type: 'downloaded', version: '1.1.0' },
      { type: 'checking', at: 't2' },
      { type: 'error', message: 'offline', at: 't2' },
      { type: 'not-available', at: 't3' }
    ])
    expect(ready).toMatchObject({ phase: 'ready', version: '1.1.0' })
  })

  it('does nothing for the unpackaged app', () => {
    expect(run([{ type: 'checking', at: 't' }], false).phase).toBe('unsupported')
  })

  it('words failures in German without the raw dump', () => {
    expect(updateErrorMessage('getaddrinfo ENOTFOUND github.com')).toContain('Keine Verbindung')
    expect(updateErrorMessage('HttpError: 404 latest.yml')).toContain('Update-Daten')
    expect(updateErrorMessage('something odd')).not.toContain('odd')
  })
})

describe('release contract', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf-8')

  it('builds update metadata for the GitHub releases of this repository', () => {
    const builder = read('electron-builder.yml')
    expect(builder).toMatch(/publish:\s*\n\s*provider: github/)
    expect(builder).toContain('repo: bookingium_clon')
  })

  it('uploads the installer together with latest.yml and the blockmap', () => {
    const workflow = read('.github/workflows/release.yml')
    expect(workflow).toContain('dist/latest.yml')
    expect(workflow).toContain('dist/Bookingium-Setup-*.exe.blockmap')
    expect(workflow).toMatch(/gh release create[\s\S]*latest\.yml/)
  })

  it('can be started from the Actions button, which raises the version and tags it', () => {
    const workflow = read('.github/workflows/release.yml')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('npm version "$BUMP" --no-git-tag-version')
    expect(workflow).toContain('git push origin "v${version}"')
    // the gate and the installer use exactly the tagged commit
    expect(workflow).toContain('ref: ${{ needs.version.outputs.tag }}')
    expect(read('.github/workflows/ci.yml')).toContain('ref: ${{ inputs.ref }}')
  })
})
