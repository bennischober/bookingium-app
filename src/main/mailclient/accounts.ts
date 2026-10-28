// Mail accounts (settings per account) stored in <userData>/mail/accounts.json.
// The password is encrypted with safeStorage (DPAPI on Windows, Keychain on
// macOS) and only decrypted in the main process when the worker asks for it.
// Without OS encryption the account cannot be saved: no plaintext passwords.
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { allowsPlainLogin } from './core/imap_options'
import {
  isCanary,
  settingsRefusal,
  smtpRefusal,
  withSingleCanary,
  type WriteAccount
} from './core/write_guard'
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
  /** B8: plain-text signature, appended to new mail and above the quote; not secret */
  signature?: string
  /**
   * The user's further own addresses that reach this mailbox (a forwarder such as info@).
   * Lower-cased; the mail linker never links a record through them. Never a sender.
   */
  aliases?: string[]
  /**
   * A7: this account's own SMTP endpoint. Missing in accounts saved before the
   * setting existed, see smtpOf(). Sandbox defaults to the IMAP host on 1025.
   */
  smtpHost?: string
  smtpPort?: number
  /**
   * A7: the SMTP encryption, which is not the IMAP one. A real mailbox is commonly
   * IMAPS 993 plus submission 587 with STARTTLS. Missing in older settings.
   */
  smtpSecurity?: ImapSecurity
  /**
   * A7 part 2: this account is the canary - the one real mailbox writes may reach.
   * Set only by an explicit manual step in the account dialog, and `saveMailAccount`
   * keeps it on at most one account.
   */
  canary?: boolean
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
   * A7 part 2: this account is the canary mailbox. It is saved as kind 'sandbox' so it
   * gets the write path at all, so the renderer cannot tell from `kind` alone - and must
   * not label a real mailbox as a local test server.
   */
  canary: boolean
}

export type SaveMailAccountInput = Omit<
  MailAccountDto,
  'id' | 'smtpHost' | 'smtpPort' | 'smtpSecurity' | 'canary' | 'aliases'
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
  /**
   * A7 part 2: admit this account as the one real mailbox writes may reach.
   * An explicit manual step: the dialog asks for confirmation first, and setting it
   * clears the flag on every other account.
   */
  canary?: boolean
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

/**
 * A7: the SMTP endpoint of a stored account. Accounts saved before the setting
 * existed default to the IMAP host on 1025 (the sandbox sink), never to a real
 * server, so an old account cannot start sending somewhere unexpected.
 */
export function smtpOf(
  account: Pick<StoredAccount, 'host' | 'smtpHost' | 'smtpPort' | 'security' | 'smtpSecurity'>
): { smtpHost: string; smtpPort: number; smtpSecurity: ImapSecurity } {
  return {
    smtpHost: account.smtpHost?.trim() ? account.smtpHost.trim() : account.host,
    smtpPort: account.smtpPort ?? 1025,
    // A7: the SMTP encryption is its own setting; older accounts fall back to the
    // IMAP one, which is right for the sandbox and conservative anywhere else
    smtpSecurity: account.smtpSecurity ?? securityOf(account as StoredAccount)
  }
}

const toDto = (account: StoredAccount): MailAccountDto => ({
  id: account.id,
  kind: account.kind,
  host: account.host,
  port: account.port,
  security: securityOf(account),
  user: account.user,
  email: account.email,
  // MR-13: the renderer reads this to put a signature on a new mail. It was stored and
  // never handed back, so every account looked like it had none.
  signature: account.signature,
  aliases: account.aliases ?? [],
  ...smtpOf(account),
  canary: isCanary(account)
})

/** Refuses settings the core would refuse later: no password in the clear across a network */
export function checkMailAccountSettings(input: {
  kind: MailAccountKind
  host: string
  security: ImapSecurity
  smtpHost?: string
  smtpSecurity?: ImapSecurity
}): void {
  // Host-based, not kind-based: the canary is a real mailbox saved with kind
  // 'sandbox' (so it gets the write path at all), and it must not carry a
  // cleartext password either. Anything off the loopback allowlist needs TLS.
  if (input.security === 'none' && !allowsPlainLogin(input.host)) {
    throw new Error('Ein echtes Postfach braucht eine Verschlüsselung (SSL/TLS oder STARTTLS)')
  }
  // I6 (MR-20): the SMTP login too, which was never checked
  const smtp = smtpRefusal({
    smtpHost: input.smtpHost?.trim() || input.host.trim(),
    security: input.security,
    smtpSecurity: input.smtpSecurity
  })
  if (smtp) throw new Error(smtp)
}

/**
 * I6 (MR-20): whether this build may admit a canary. The account dialog offers the sandbox
 * kind only in a development build, and main now holds the same line: a packaged build admits
 * a canary only when it was started with BOOKINGIUM_ALLOW_CANARY=1.
 */
export function canaryAllowed(): boolean {
  return !app.isPackaged || process.env.BOOKINGIUM_ALLOW_CANARY === '1'
}

/** What the core's write guard sees of a stored account */
function writeAccountOf(account: StoredAccount): WriteAccount {
  return {
    id: account.id,
    kind: account.kind,
    imapHost: account.host,
    imapPort: account.port,
    security: securityOf(account),
    ...smtpOf(account),
    email: account.email,
    canary: account.canary
  }
}

/**
 * I6 (MR-20): what the canary admission is for. The admission names one mailbox: its server,
 * login and own address (the only one a canary may mail), and the server its mail and
 * password go to.
 */
function canaryIdentity(account: StoredAccount): string {
  const smtp = smtpOf(account)
  return JSON.stringify([
    account.host.toLowerCase(),
    account.port,
    account.user,
    account.email.toLowerCase(),
    smtp.smtpHost.toLowerCase(),
    smtp.smtpPort
  ])
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
    kind: input.kind,
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
    smtpSecurity: input.smtpSecurity,
    // I6: the flag means something on a sandbox-kind account only; switching the kind revokes it
    canary: input.canary === true && input.kind === 'sandbox' ? true : undefined
  }
  // I6 (MR-20): the form sends back the flag it loaded, so a changed server, login or address
  // kept it and a different mailbox became writable without a new confirmation. A carried-over
  // flag ends here; the changed mailbox is saved read-only, and admitting it again is a new step.
  if (
    existing?.canary === true &&
    isCanary(account) &&
    canaryIdentity(existing) !== canaryIdentity(account)
  ) {
    account.canary = undefined
  }
  // Unchecking the flag revokes it: the real mailbox stays, read-only, instead of being refused
  if (existing?.canary === true && !isCanary(account) && settingsRefusal(writeAccountOf(account))) {
    account.kind = 'production-readonly'
  }
  if (isCanary(account) && !canaryAllowed()) {
    throw new Error('Ein Testpostfach kann nur in der Entwicklerversion freigegeben werden')
  }
  const refusal = settingsRefusal(writeAccountOf(account))
  if (refusal) throw new Error(refusal)
  return { accounts, existing, account }
}

/** I6 (MR-20): throws what `saveMailAccount` would throw, without saving anything */
export function checkMailAccountSave(input: SaveMailAccountInput): void {
  resolveMailAccount(input)
}

export function saveMailAccount(input: SaveMailAccountInput): MailAccountDto {
  const { accounts, existing, account } = resolveMailAccount(input)
  // A7 part 2: at most one canary. Admitting a second real mailbox would widen
  // the write path silently, so it clears the flag on every other account instead.
  const next = existing
    ? accounts.map((a) => (a.id === existing.id ? account : a))
    : [...accounts, account]
  writeAll(isCanary(account) ? withSingleCanary(next, account.id) : next)
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
