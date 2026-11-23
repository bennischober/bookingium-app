import { singleton, inject } from 'tsyringe'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { SettingsRepository } from '../repositories/SettingsRepository'
import type { AccessStatusDto } from '../api/schemas/access.schema'

// ========================================
// Staff access (Mitarbeiterzugang, #262)
// ========================================
// A computer can be switched to staff access: the company-internal areas (DATEV hand-over,
// own company and invoice numbering, CSV import, backup and restore, setting up the sync) are
// locked, in the menus and in the main process. An optional PIN unlocks them for this session.
//
// Both values are app_setting rows of this computer only (LOCAL_SETTING_KEYS), so the sync
// never carries them: switching one computer to staff access leaves the others as they are.
//
// This is the first step of #262. It keeps an employee out of the internal areas in the app;
// it does not hide records, and whoever can open the database file can still read everything.
// Filtered sync per employee is the follow-up.
//
// Messages are German like the other main-process errors (the main process has no UI language).

export const STAFF_MODE_KEY = 'staffMode'
export const STAFF_PIN_KEY = 'staffPin'

/** 4 to 12 digits, like a phone PIN */
export const PIN_PATTERN = /^\d{4,12}$/

// After this many wrong PINs in a row, unlocking waits a while
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 30_000

const SCRYPT_KEYLEN = 32

function hashPin(pin: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN)
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

function pinMatches(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function parse(raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export class AccessError extends Error {}

// One instance: the unlock of this session is shared by every router and IPC handler
@singleton()
export class AccessService {
  // Unlocked for this session (until "Sperren" or the app quits); never stored
  private unlocked = false
  private failedAttempts = 0
  private lockedUntil = 0

  constructor(@inject(SettingsRepository) private settingsRepository: SettingsRepository) {}

  private stored(): { staffMode: boolean; pin: string | null } {
    const all = this.settingsRepository.getAll()
    const pin = parse(all[STAFF_PIN_KEY])
    return {
      staffMode: parse(all[STAFF_MODE_KEY]) === true,
      pin: typeof pin === 'string' && pin !== '' ? pin : null
    }
  }

  status(now = Date.now()): AccessStatusDto {
    const { staffMode, pin } = this.stored()
    return {
      staffMode,
      hasPin: pin !== null,
      unlocked: staffMode && this.unlocked,
      locked: staffMode && !this.unlocked,
      retryAfterSeconds: this.lockedUntil > now ? Math.ceil((this.lockedUntil - now) / 1000) : 0
    }
  }

  /** Whether the internal areas are open: no staff access, or unlocked for this session */
  isAdmin(): boolean {
    return !this.status().locked
  }

  assertAdmin(): void {
    if (!this.isAdmin())
      throw new AccessError(
        'Dieser Bereich ist im Mitarbeiterzugang gesperrt. Zum Entsperren: Einstellungen › Allgemein.'
      )
  }

  /** Switches this computer to staff access, optionally with a PIN; locks right away */
  enable(pin: string | null): AccessStatusDto {
    this.assertAdmin()
    if (pin !== null) this.checkPinFormat(pin)
    this.settingsRepository.setMany({
      [STAFF_MODE_KEY]: JSON.stringify(true),
      [STAFF_PIN_KEY]: JSON.stringify(pin === null ? '' : hashPin(pin))
    })
    this.unlocked = false
    return this.status()
  }

  /** Back to full access; only while unlocked. The PIN goes with it. */
  disable(): AccessStatusDto {
    this.assertAdmin()
    this.settingsRepository.setMany({
      [STAFF_MODE_KEY]: JSON.stringify(false),
      [STAFF_PIN_KEY]: JSON.stringify('')
    })
    this.unlocked = false
    this.failedAttempts = 0
    this.lockedUntil = 0
    return this.status()
  }

  /** Sets, changes or (null) removes the PIN; only while unlocked */
  setPin(pin: string | null): AccessStatusDto {
    this.assertAdmin()
    if (!this.stored().staffMode)
      throw new AccessError('Der Mitarbeiterzugang ist nicht eingeschaltet.')
    if (pin !== null) this.checkPinFormat(pin)
    this.settingsRepository.setMany({
      [STAFF_PIN_KEY]: JSON.stringify(pin === null ? '' : hashPin(pin))
    })
    return this.status()
  }

  /** Opens the internal areas for this session; asks for the PIN when one is set */
  unlock(pin: string, now = Date.now()): AccessStatusDto {
    const { staffMode, pin: stored } = this.stored()
    if (!staffMode) return this.status(now)
    if (this.lockedUntil > now) {
      throw new AccessError(
        `Zu viele falsche Versuche. Bitte in ${Math.ceil((this.lockedUntil - now) / 1000)} Sekunden noch einmal.`
      )
    }
    if (stored !== null && !pinMatches(pin, stored)) {
      this.failedAttempts += 1
      if (this.failedAttempts >= MAX_ATTEMPTS) {
        this.failedAttempts = 0
        this.lockedUntil = now + LOCKOUT_MS
      }
      throw new AccessError('Die PIN stimmt nicht.')
    }
    this.failedAttempts = 0
    this.lockedUntil = 0
    this.unlocked = true
    return this.status(now)
  }

  /** Locks the internal areas again */
  lock(): AccessStatusDto {
    this.unlocked = false
    return this.status()
  }

  private checkPinFormat(pin: string): void {
    if (!PIN_PATTERN.test(pin)) throw new AccessError('Die PIN besteht aus 4 bis 12 Ziffern.')
  }
}
