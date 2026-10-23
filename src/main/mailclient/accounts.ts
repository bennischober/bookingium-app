// Mail accounts (settings per account) stored in <userData>/mail/accounts.json.
// The password is encrypted with safeStorage (DPAPI on Windows, Keychain on
// macOS) and only decrypted in the main process when the worker asks for it.
// Without OS encryption the account cannot be saved: no plaintext passwords.
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { allowsPlainLogin } from './core/imap_options'
import type { ImapSecurity } from './core/types'

export type MailAccountKind = 'sandbox' | 'production-readonly'

type StoredAccount = {
  id: string
  kind: MailAccountKind
  host: string
  port: number
  /** missing in accounts saved before the setting existed, see securityOf */
  security?: ImapSecurity
  user: string
  email: string
  /** base64 of safeStorage.encryptString(password) */
  password: string
}

/** Account without its password, safe to hand to the renderer */
export type MailAccountDto = Omit<StoredAccount, 'password' | 'security'> & {
  security: ImapSecurity
}

export type SaveMailAccountInput = Omit<MailAccountDto, 'id'> & {
  id?: string
  /** omitted when editing: keep the stored password */
  password?: string
}

export function mailRoot(): string {
  return join(app.getPath('userData'), 'mail')
}

function accountsFile(): string {
  return join(mailRoot(), 'accounts.json')
}

function readAll(): StoredAccount[] {
  const file = accountsFile()
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf-8')) as StoredAccount[]
}

function writeAll(accounts: StoredAccount[]): void {
  mkdirSync(mailRoot(), { recursive: true })
  // Write then rename: a crash never leaves a half-written file
  const tmp = `${accountsFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(accounts, null, 2), 'utf-8')
  renameSync(tmp, accountsFile())
}

/** Older accounts had no setting: what the core used to pick from the port, except that a live
 * server now always gets STARTTLS rather than a cleartext login */
function securityOf(account: StoredAccount): ImapSecurity {
  if (account.security) return account.security
  if (account.port === 993) return 'tls'
  return account.kind === 'sandbox' ? 'none' : 'starttls'
}

const toDto = (account: StoredAccount): MailAccountDto => ({
  id: account.id,
  kind: account.kind,
  host: account.host,
  port: account.port,
  security: securityOf(account),
  user: account.user,
  email: account.email
})

/** Refuses settings the core would refuse later: no password in the clear across a network */
export function checkMailAccountSettings(input: {
  kind: MailAccountKind
  host: string
  security: ImapSecurity
}): void {
  if (input.kind !== 'sandbox' && input.security === 'none' && !allowsPlainLogin(input.host)) {
    throw new Error('Ein echtes Postfach braucht eine Verschlüsselung (SSL/TLS oder STARTTLS)')
  }
}

export function listMailAccounts(): MailAccountDto[] {
  return readAll().map(toDto)
}

export function saveMailAccount(input: SaveMailAccountInput): MailAccountDto {
  const accounts = readAll()
  const existing = input.id ? accounts.find((a) => a.id === input.id) : undefined
  if (input.id && !existing) throw new Error('Konto nicht gefunden')
  checkMailAccountSettings(input)

  let password = existing?.password
  if (input.password !== undefined) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Die Verschlüsselung des Betriebssystems ist nicht verfügbar')
    }
    password = safeStorage.encryptString(input.password).toString('base64')
  }
  if (!password) throw new Error('Passwort fehlt')

  const account: StoredAccount = {
    id: existing?.id ?? randomUUID(),
    kind: input.kind,
    host: input.host.trim(),
    port: input.port,
    security: input.security,
    user: input.user.trim(),
    email: input.email.trim(),
    password
  }
  writeAll(
    existing ? accounts.map((a) => (a.id === account.id ? account : a)) : [...accounts, account]
  )
  return toDto(account)
}

/** Removes the account settings; the downloaded mail stays until its folder is deleted */
export function deleteMailAccount(id: string): void {
  writeAll(readAll().filter((a) => a.id !== id))
}

/** Decrypted credentials, for the worker only (never sent to the renderer) */
export function mailCredentials(id: string): { user: string; pass: string } {
  const account = readAll().find((a) => a.id === id)
  if (!account) throw new Error('Konto nicht gefunden')
  return {
    user: account.user,
    pass: safeStorage.decryptString(Buffer.from(account.password, 'base64'))
  }
}
