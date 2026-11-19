// #243: an earlier entry of a computer leaves the folder only when it never wrote a change
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FolderTransport } from '../src/main/sync/transport'

const device = (id: string, createdAt: string) => ({
  id,
  name: 'Beispiel-Laptop',
  prefix: 1,
  createdAt,
  appVersion: '1.4.0'
})

describe('removeEmptyDevice', () => {
  it('removes an entry without batches and keeps one with batches', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'bookingium-devices-'))
    const transport = new FolderTransport(folder)
    await transport.writeDevice(device('dev-empty', '2026-11-01T10:00:00.000Z'))
    await transport.writeDevice(device('dev-busy', '2026-11-02T10:00:00.000Z'))
    mkdirSync(join(folder, 'geraete', 'dev-busy', 'aenderungen'), { recursive: true })
    writeFileSync(join(folder, 'geraete', 'dev-busy', 'aenderungen', '0000000001.json'), '{}')

    expect(await transport.hasDevice('dev-empty')).toBe(true)
    await transport.removeEmptyDevice('dev-empty')
    // a running computer notices the missing entry on its next run and writes it again
    expect(await transport.hasDevice('dev-empty')).toBe(false)
    await expect(transport.removeEmptyDevice('dev-busy')).rejects.toThrow(/bleibt/)
    expect((await transport.listDevices()).map((d) => d.id)).toEqual(['dev-busy'])
  })
})
