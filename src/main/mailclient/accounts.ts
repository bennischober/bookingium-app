// Mail accounts (settings per account) stored in <userData>/mail/accounts.json.
// The password is encrypted with safeStorage (DPAPI on Windows, Keychain on
// macOS) and only decrypted in the main process when the worker asks for it.
// Without OS encryption the account cannot be saved: no plaintext passwords.
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { allowsPlainLogin } from './core/imap_options'
import { settingsRefusal } from './core/write_guard'
import type { ImapSecurity } from './core/types'

type StoredAccount = {
  id: string
  /**
   * "Nur lesen": the app reads this mailbox and writes nothing to it. Accounts saved before
   * the setting existed carried a `kind` instead; they are read as writable (the user lifted
   * them on 2026-10-28), see readAll.
   */
  readOnly: boolean
  host: string
  port: number
  /** missing in accounts saved before the setting existed, see securityOf */
  security?: ImapSecurity
  user: string
  email: string
  /** base64 of safeStorage.encryptString(password) */
  password: string
  /** B8: plain-text signature, appended to new mail and above the quote; not secret */
  signature?: string
  /**
   * The user's further own addresses that reach this mailbox (a forwarder such as info@).
   * Lower-cased; the mail linker never links a record through them. Never a sender.
   */
  aliases?: string[]
  /**
   * A7: this account's own SMTP endpoint. Missing in accounts saved before the
   * setting existed, see smtpOf(). They default to the IMAP host on 1025.
   */
  smtpHost?: string
  smtpPort?: number
  /**
   * A7: the SMTP encryption, which is not the IMAP one. A real mailbox is commonly
   * IMAPS 993 plus submission 587 with STARTTLS. Missing in older settings.
   */
  smtpSecurity?: ImapSecurity
}

/** Account without its password, safe to hand to the renderer */
export type MailAccountDto = Omit<
  StoredAccount,
  'password' | 'security' | 'smtpSecurity' | 'aliases'
> & {
  security: ImapSecurity
  aliases: string[]
  /** A7: resolved, so the renderer shows what a write would actually use */
  smtpHost: string
  smtpPort: number
  smtpSecurity: ImapSecurity
  /**
   * Why the write guard refuses these stored settings (a cleartext login across a network,
   * saved before main checked it), or null. Kept apart from `readOnly`, which stays the user's
   * own setting, so the renderer offers no write the core would refuse.
   */
  writeRefusal: string | null
}

export type SaveMailAccountInput = Omit<
  MailAccountDto,
  'id' | 'smtpHost' | 'smtpPort' | 'smtpSecurity' | 'aliases' | 'writeRefusal'
> & {
  id?: string
  /** omitted: keep the stored ones */
  aliases?: string[]
  /** omitted when editing: keep the stored password */
  password?: string
  /** A7: optional - defaults to the IMAP host on 1025 */
  smtpHost?: string
  smtpPort?: number
  /** A7: optional - defaults to the IMAP security */
  smtpSecurity?: ImapSecurity
}

export function mailRoot(): string {
  return join(app.getPath('userData'), 'mail')
}

function accountsFile(): string {
  return join(mailRoot(), 'accounts.json')
}

/** What accounts.json held before the "Nur lesen" setting replaced the account kinds */
type LegacyFields = {
  readOnly?: boolean
  kind?: 'sandbox' | 'production-readonly'
  canary?: boolean
}

/**
 * One account as stored, brought to the current shape. The kinds and the canary flag are gone:
 * an account without the setting is writable, and a missing encryption is filled in from the
 * kind it had (the loopback test server logged in without one, a real server gets STARTTLS).
 */
export function normalizeStoredAccount(raw: StoredAccount & LegacyFields): StoredAccount {
  const { kind, ...rest } = raw
  const account: StoredAccount & Pick<LegacyFields, 'canary'> = { ...rest }
  delete account.canary
  const security =
    account.security ??
    (account.port === 993
      ? 'tls'
      : kind === 'sandbox' && allowsPlainLogin(account.host)
        ? 'none'
        : 'starttls')
  return { ...account, readOnly: raw.readOnly ?? false, security }
}

function readAll(): StoredAccount[] {
  const file = accountsFile()
  if (!existsSync(file)) return []
  const raw = JSON.parse(readFileSync(file, 'utf-8')) as (StoredAccount & LegacyFields)[]
  return raw.map(normalizeStoredAccount)
}

function writeAll(accounts: StoredAccount[]): void {
  mkdirSync(mailRoot(), { recursive: true })
  // Write then rename: a crash never leaves a half-written file
  const tmp = `${accountsFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(accounts, null, 2), 'utf-8')
  renameSync(tmp, accountsFile())
}

/** Older accounts had no setting; readAll fills it in, so this only covers a form's input */
function securityOf(account: Pick<StoredAccount, 'host' | 'port' | 'security'>): ImapSecurity {
  if (account.security) return account.security
  if (account.port === 993) return 'tls'
  return allowsPlainLogin(account.host) ? 'none' : 'starttls'
}

/**
 * A7: the SMTP endpoint of a stored account. Accounts saved before the setting
 * existed default to the IMAP host on 1025 (the local test server's sink), never to
 * another server, so an old account cannot start sending somewhere unexpected.
 */
export function smtpOf(
  account: Pick<StoredAccount, 'host' | 'smtpHost' | 'smtpPort' | 'security' | 'smtpSecurity'>
): { smtpHost: string; smtpPort: number; smtpSecurity: ImapSecurity } {
  return {
    smtpHost: account.smtpHost?.trim() ? account.smtpHost.trim() : account.host,
    smtpPort: account.smtpPort ?? 1025,
    // A7: the SMTP encryption is its own setting; older accounts fall back to the
    // IMAP one, which is right for the local test server and conservative anywhere else
    smtpSecurity: account.smtpSecurity ?? securityOf(account as StoredAccount)
  }
}

const toDto = (account: StoredAccount): MailAccountDto => {
  const security = securityOf(account)
  const smtp = smtpOf(account)
  return {
    id: account.id,
    readOnly: account.readOnly,
    host: account.host,
    port: account.port,
    security,
    user: account.user,
    email: account.email,
    // MR-13: the renderer reads this to put a signature on a new mail. It was stored and
    // never handed back, so every account looked like it had none.
    signature: account.signature,
    aliases: account.aliases ?? [],
    ...smtp,
    // the same check the core's write guard makes, so the UI and the core agree
    writeRefusal: settingsRefusal({
      imapHost: account.host,
      security,
      smtpHost: smtp.smtpHost,
      smtpSecurity: smtp.smtpSecurity
    })
  }
}

/** Refuses settings the core would refuse later: no password in the clear across a network */
export function checkMailAccountSettings(input: {
  host: string
  security: ImapSecurity
  smtpHost?: string
  smtpSecurity?: ImapSecurity
}): void {
  // I6 (MR-20): host-based, IMAP and SMTP; only the loopback test server may skip encryption
  const host = input.host.trim()
  const refusal = settingsRefusal({
    imapHost: host,
    security: input.security,
    smtpHost: input.smtpHost?.trim() || host,
    smtpSecurity: input.smtpSecurity
  })
  if (refusal) throw new Error(refusal)
}

/**
 * The further own addresses as stored: lower-cased and trimmed, address-shaped, once each
 * and without the account's own address. None at all is stored as no list.
 */
export function normalizeAliases(email: string, aliases: readonly string[]): string[] | undefined {
  const seen = new Set([email.trim().toLowerCase()])
  const out: string[] = []
  for (const alias of aliases) {
    const address = alias.trim().toLowerCase()
    if (!address.includes('@') || seen.has(address)) continue
    seen.add(address)
    out.push(address)
  }
  return out.length > 0 ? out : undefined
}

export function listMailAccounts(): MailAccountDto[] {
  return readAll().map(toDto)
}

/**
 * The account `input` would store, checked the way `saveMailAccount` checks it. I6 (MR-20):
 * the router runs this before the connection test, so refused settings never log in anywhere.
 */
function resolveMailAccount(input: SaveMailAccountInput): {
  accounts: StoredAccount[]
  existing: StoredAccount | undefined
  account: StoredAccount
} {
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

  // The id names the folder with the downloaded mail. Another server or login is another
  // mailbox: it gets a fresh folder rather than a mix of both, the old one stays like a
  // deleted account's
  const keepsMailbox = existing !== undefined && sameMailbox(existing, input)
  // I11 (MR-33): the stored password never moves to another server or login
  if (existing && !keepsMailbox && input.password === undefined) {
    throw new Error('Passwort fehlt')
  }
  const account: StoredAccount = {
    id: keepsMailbox ? existing.id : randomUUID(),
    readOnly: input.readOnly,
    host: input.host.trim(),
    port: input.port,
    security: input.security,
    user: input.user.trim(),
    email: input.email.trim(),
    password,
    // MR-13: an OMITTED signature keeps the stored one (the account form sends nothing when the
    // user never touched the field), while an explicit empty string clears it - otherwise opening the
    // form and saving would wipe a signature the user never edited.
    signature:
      input.signature === undefined ? existing?.signature : input.signature.trim() || undefined,
    aliases:
      input.aliases === undefined
        ? existing?.aliases
        : normalizeAliases(input.email, input.aliases),
    smtpHost: input.smtpHost?.trim() ? input.smtpHost.trim() : undefined,
    smtpPort: input.smtpPort,
    smtpSecurity: input.smtpSecurity
  }
  return { accounts, existing, account }
}

/** I6 (MR-20): throws what `saveMailAccount` would throw, without saving anything */
export function checkMailAccountSave(input: SaveMailAccountInput): void {
  resolveMailAccount(input)
}

export function saveMailAccount(input: SaveMailAccountInput): MailAccountDto {
  const { accounts, existing, account } = resolveMailAccount(input)
  writeAll(
    existing ? accounts.map((a) => (a.id === existing.id ? account : a)) : [...accounts, account]
  )
  return toDto(account)
}

/** Removes the account settings; the downloaded mail stays until its folder is deleted */
export function deleteMailAccount(id: string): void {
  writeAll(readAll().filter((a) => a.id !== id))
}

/** Same server, port and login: the stored password belongs to that mailbox and no other */
function sameMailbox(
  account: StoredAccount,
  target: { host: string; port: number; user: string }
): boolean {
  return (
    account.host.toLowerCase() === target.host.trim().toLowerCase() &&
    account.port === target.port &&
    account.user === target.user.trim()
  )
}

/**
 * I11 (MR-33): the stored password of `id` for a connection test, or undefined when the form
 * names another server, port or login. A typo in the host must not send the password there.
 */
export function storedPasswordFor(
  id: string,
  target: { host: string; port: number; user: string }
): string | undefined {
  const account = readAll().find((a) => a.id === id)
  if (!account || !sameMailbox(account, target)) return undefined
  return safeStorage.decryptString(Buffer.from(account.password, 'base64'))
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
