// Mail accounts (settings per account) stored in <userData>/mail/accounts.json.
// The password is encrypted with safeStorage (DPAPI on Windows, Keychain on
// macOS) and only decrypted in the main process when the worker asks for it.
// Without OS encryption the account cannot be saved: no plaintext passwords.
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export type MailAccountKind = 'sandbox' | 'production-readonly'

type StoredAccount = {
  id: string
  kind: MailAccountKind
  host: string
  port: number
  user: string
  email: string
  /** base64 of safeStorage.encryptString(password) */
  password: string
}

/** Account without its password, safe to hand to the renderer */
export type MailAccountDto = Omit<StoredAccount, 'password'>

export type SaveMailAccountInput = Omit<StoredAccount, 'id' | 'password'> & {
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

const toDto = ({ id, kind, host, port, user, email }: StoredAccount): MailAccountDto => ({
  id,
  kind,
  host,
  port,
  user,
  email
})

export function listMailAccounts(): MailAccountDto[] {
  return readAll().map(toDto)
}

export function saveMailAccount(input: SaveMailAccountInput): MailAccountDto {
  const accounts = readAll()
  const existing = input.id ? accounts.find((a) => a.id === input.id) : undefined
  if (input.id && !existing) throw new Error('Konto nicht gefunden')

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
