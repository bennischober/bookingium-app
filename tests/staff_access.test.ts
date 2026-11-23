// #262: staff access (Mitarbeiterzugang) of one computer, with an optional PIN

import 'reflect-metadata'
import { beforeEach, describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { setupTestDb, getTestDb } from './helpers/setup'
import { AccessService, STAFF_PIN_KEY } from '../src/main/services/AccessService'
import { accessRouter } from '../src/main/api/routers/access.router'
import { importRouter } from '../src/main/api/routers/import.router'
import { datevRouter } from '../src/main/api/routers/datev.router'
import { isLocalSettingKey } from '../src/main/sync/tables'

setupTestDb()

const service = () => container.resolve(AccessService)
const caller = () => accessRouter.createCaller({})

function storedPin(): string | undefined {
  const row = getTestDb()
    .sqlite.prepare('SELECT value FROM app_setting WHERE key = ?')
    .get(STAFF_PIN_KEY) as { value: string } | undefined
  return row?.value
}

describe('staff access', () => {
  beforeEach(async () => {
    // back to full access between tests
    const status = service().status()
    if (status.locked) {
      getTestDb()
        .sqlite.prepare("DELETE FROM app_setting WHERE key IN ('staffMode', 'staffPin')")
        .run()
    } else if (status.staffMode) await caller().disable()
    service().lock()
  })

  it('is off on a new computer: everything is open', async () => {
    expect(await caller().status()).toEqual({
      staffMode: false,
      hasPin: false,
      unlocked: false,
      locked: false,
      retryAfterSeconds: 0
    })
    await expect(datevRouter.createCaller({}).listNotHandedOver()).resolves.toEqual([])
  })

  it('stays on this computer: the sync never carries its keys', () => {
    expect(isLocalSettingKey('staffMode')).toBe(true)
    expect(isLocalSettingKey('staffPin')).toBe(true)
  })

  it('locks the internal areas in the main process, not only in the menus', async () => {
    await caller().enable({ pin: null })
    expect((await caller().status()).locked).toBe(true)

    await expect(datevRouter.createCaller({}).listNotHandedOver()).rejects.toMatchObject({
      code: 'FORBIDDEN'
    })
    await expect(
      importRouter.createCaller({}).preview({ target: 'bands', rows: [], mapping: {} } as never)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // managing staff access itself needs an unlock first
    await expect(caller().disable()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('unlocks without a PIN when none is set, and locks again', async () => {
    await caller().enable({ pin: null })
    expect(await caller().unlock({ pin: '' })).toMatchObject({ locked: false, unlocked: true })
    await expect(datevRouter.createCaller({}).listNotHandedOver()).resolves.toEqual([])
    expect(await caller().lock()).toMatchObject({ locked: true, unlocked: false })
  })

  it('asks for the PIN, stores only its hash, and refuses a wrong one', async () => {
    await caller().enable({ pin: '4711' })
    expect(storedPin()).not.toContain('4711')
    expect(storedPin()).toMatch(/^"scrypt:[0-9a-f]+:[0-9a-f]+"$/)
    expect((await caller().status()).hasPin).toBe(true)

    await expect(caller().unlock({ pin: '1234' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Die PIN stimmt nicht.'
    })
    expect((await caller().status()).locked).toBe(true)
    expect(await caller().unlock({ pin: '4711' })).toMatchObject({ locked: false })
  })

  it('waits after five wrong PINs in a row', () => {
    service().enable(null)
    service().unlock('')
    service().setPin('2468')
    service().lock()
    const start = 1_000_000
    for (let i = 0; i < 5; i++)
      expect(() => service().unlock('0000', start)).toThrow('PIN stimmt nicht')
    expect(() => service().unlock('2468', start + 1000)).toThrow('Zu viele falsche Versuche')
    expect(service().status(start + 1000).retryAfterSeconds).toBe(29)
    expect(service().unlock('2468', start + 31_000).locked).toBe(false)
  })

  it('changes and removes the PIN only while unlocked', async () => {
    await caller().enable({ pin: '1357' })
    await expect(caller().setPin({ pin: '9999' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await caller().unlock({ pin: '1357' })
    await caller().setPin({ pin: '9999' })
    await caller().lock()
    await expect(caller().unlock({ pin: '1357' })).rejects.toThrow()
    await caller().unlock({ pin: '9999' })
    expect(await caller().setPin({ pin: null })).toMatchObject({ hasPin: false })
  })

  it('takes a PIN of 4 to 12 digits only', async () => {
    await expect(caller().enable({ pin: '12' })).rejects.toThrow()
    await expect(caller().enable({ pin: 'abcd' })).rejects.toThrow()
    expect((await caller().status()).staffMode).toBe(false)
  })

  it('switching off needs the unlock and drops the PIN', async () => {
    await caller().enable({ pin: '8642' })
    await caller().unlock({ pin: '8642' })
    expect(await caller().disable()).toMatchObject({
      staffMode: false,
      hasPin: false,
      locked: false
    })
    expect(storedPin()).toBe('""')
  })
})
