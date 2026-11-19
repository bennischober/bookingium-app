// A computer not syncing yet finds the sync group in its OneDrive (or Google Drive, Dropbox), so
// joining is one click; the settings show when each computer last put changes into the folder.
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cloudRoots, findSyncFolders } from '../src/main/sync/findFolders'
import { FolderTransport, GROUP_FILE } from '../src/main/sync/transport'

const root = mkdtempSync(join(tmpdir(), 'bookingum-syncfind-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const group = (folder: string): void => {
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, GROUP_FILE),
    JSON.stringify({ app: 'bookingium', format: 1, id: 'abc', createdAt: '2026-11-18' })
  )
}

describe('finding a sync group', () => {
  it('lists the cloud folders of the computer once each', () => {
    const roots = cloudRoots(
      { OneDrive: 'C:\\Users\\u\\OneDrive', OneDriveConsumer: 'C:\\Users\\u\\OneDrive\\' },
      'C:\\Users\\u'
    )
    expect(roots.filter((r) => r === 'C:\\Users\\u\\OneDrive')).toHaveLength(1)
    expect(roots.some((r) => r.endsWith('Dropbox'))).toBe(true)
  })

  it('finds groups up to two levels deep and nothing else', async () => {
    const oneDrive = join(root, 'OneDrive')
    group(join(oneDrive, 'Bookingium'))
    group(join(oneDrive, 'Dokumente', 'Firma', 'Abgleich'))
    mkdirSync(join(oneDrive, 'Bilder'), { recursive: true })
    writeFileSync(join(oneDrive, 'Bilder', GROUP_FILE), JSON.stringify({ app: 'other' }))
    group(join(oneDrive, 'a', 'b', 'c'))
    const found = await findSyncFolders([oneDrive, join(root, 'missing')])
    expect(found).toEqual([join(oneDrive, 'Bookingium')])
    expect(await findSyncFolders([oneDrive], 3)).toContain(
      join(oneDrive, 'Dokumente', 'Firma', 'Abgleich')
    )
  })
})

describe('device activity', () => {
  it('is the time of the newest batch, null for a device that never wrote one', async () => {
    const folder = join(root, 'activity')
    const batches = join(folder, 'geraete', 'dev1', 'aenderungen')
    mkdirSync(batches, { recursive: true })
    mkdirSync(join(folder, 'geraete', 'dev2'), { recursive: true })
    writeFileSync(join(batches, '0000000001.json'), '{}')
    writeFileSync(join(batches, '0000000002.json'), '{}')
    const when = new Date('2026-11-19T10:08:00Z')
    utimesSync(join(batches, '0000000002.json'), when, when)
    const transport = new FolderTransport(folder)
    expect(await transport.deviceLastBatchAt('dev1')).toBe(when.toISOString())
    expect(await transport.deviceLastBatchAt('dev2')).toBeNull()
  })
})
