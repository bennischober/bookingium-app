// Write-guard: ALL IMAP/SMTP write operations live here, and this module decides
// PER ACCOUNT whether a write may go out. The loopback allowlist is fixed and the
// decision is made from the account itself - no global "the sandbox" anymore.
//
// A7 part 1: an account may be written to only if it is a sandbox account AND both
// its IMAP and SMTP hosts are on the loopback allowlist.
//
// A7 part 2: the CANARY is the one exception - exactly one real mailbox, admitted by
// name. Not a third account kind: `MailAccountKind` is read in 22 places and every one
// of them would be a place a real account could slip through, while this admission is
// auditable on one screen and revoked by switching the flag off in the account dialog (it was a
// hard-coded id in the prototype; this is a flag set from the UI).
//
// I6 (MR-20): the flag design is signed off by the user (2026-10-27) and main enforces it,
// not the renderer: `settingsRefusal` runs before an account is saved, `accounts.ts` drops
// the flag when the account's server, login or address changes, and the core asks
// `writeRefusal` before it journals any op.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import net from 'net';
import type { ImapSecurity } from './types.js';
import { allowsPlainLogin, IMAP_TIMEOUTS } from './imap_options.js';

// I6 (MR-20): loopback only. The docker-internal names `sandbox-dovecot` and `sandbox-mailpit`
// resolved through DNS and still got `rejectUnauthorized: false`; nothing connects to them.
export const SANDBOX_ALLOWLIST = new Set([
  '127.0.0.1', 'localhost', '::1',
]);

/**
 * A7 part 2: whether this account is the canary - the ONE real mailbox writes may reach.
 *
 * A flag rather than an account id: the id names the account's data folder, so
 * re-keying an account to admit it would make it download everything again. A flag
 * is also revocable without touching the file, and `saveMailAccount` enforces that at
 * most one account carries it.
 *
 * It is still an explicit manual step - a danger-styled toggle in the account dialog
 * behind a confirm that names the consequence, never something the app sets itself.
 * `kind` stays the outer gate: the canary is saved as a sandbox account, so the guard
 * is what decides whether it may write.
 */
export interface CanaryFlag {
  canary?: boolean
}

/** Whether this account is the canary - the single real mailbox writes may reach */
export function isCanary(account: CanaryFlag): boolean {
  return account.canary === true
}

/**
 * A7 part 2: at most one account may be the canary.
 *
 * Admitting a second real mailbox would widen the write path without anyone
 * deciding to, so saving a canary clears the flag on every other account. Pure, so
 * the rule is tested without Electron's account store.
 */
export function withSingleCanary<T extends CanaryFlag & { id: string }>(
  accounts: T[],
  admittedId: string
): T[] {
  return accounts.map((a) => (a.id === admittedId ? a : { ...a, canary: undefined }))
}

/** What the write guard needs to know about one account */
export interface WriteAccount {
  id: string;
  /** 'sandbox' is the only kind that may be written to */
  kind: 'sandbox' | 'production-readonly';
  imapHost: string;
  imapPort: number;
  security: ImapSecurity;
  smtpHost: string;
  smtpPort: number;
  /**
   * A7: the SMTP encryption, which is NOT the IMAP one. A real mailbox is commonly
   * IMAPS 993 plus submission 587 with STARTTLS, and reusing the IMAP setting would
   * open a cleartext session to a server that wants TLS. Missing in older settings:
   * see smtpSecurityOf().
   */
  smtpSecurity?: ImapSecurity;
  /**
   * A7 part 2: the account's own address. A canary send may only go to an address
   * this app owns, and this is what it owns - so a canary cannot mail a stranger.
   */
  email?: string;
  /** A7 part 2: the canary flag - the single real mailbox writes may reach */
  canary?: boolean;
}

/** The endpoints a write needs; credentials come from the host, never from here */
export interface WriteEndpoints {
  imapHost: string;
  imapPort: number;
  security: ImapSecurity;
  smtpHost: string;
  smtpPort: number;
}

const normalizeHost = (host: string): string => host.trim().toLowerCase();

/** Whether a host is on the loopback allowlist (never widen this) */
export function isSandboxHost(host: string): boolean {
  return SANDBOX_ALLOWLIST.has(normalizeHost(host));
}

/** Throws unless the host is on the loopback allowlist */
export function assertSandboxHost(host: string): void {
  if (!isSandboxHost(host)) {
    throw new Error(`WRITE GUARD: refusing write operation against non-sandbox host "${host}". ` +
      `Write operations are only permitted against ${[...SANDBOX_ALLOWLIST].join(', ')}.`);
  }
}

/**
 * A7: the reason an account may not be written to, or null when it may.
 *
 * The canary is admitted by name, whatever its hosts: it is a real mailbox, so its
 * TLS is verified (it is not on the loopback allowlist, see tlsOptions). Every other
 * account must be a sandbox account on the loopback allowlist - a production account
 * is read-only by design, and a sandbox account pointed at a real server is refused
 * rather than trusted.
 */
export function writeRefusal(account: WriteAccount): string | null {
  // kind is the OUTER gate: only a sandbox-kind account gets the write path at all
  if (account.kind !== 'sandbox') {
    return `Konto ${account.id} ist schreibgeschützt.`
  }
  // A7 part 2: the canary is then admitted by name, whatever its hosts - it is a
  // real mailbox, so its TLS is verified (it is not on the loopback allowlist)
  if (!isCanary(account) && (!isSandboxHost(account.imapHost) || !isSandboxHost(account.smtpHost))) {
    return `Konto ${account.id}: Schreiben ist nur gegen den lokalen Testserver erlaubt.`
  }
  // I6 (MR-20): an account stored before main checked this must not log in to SMTP in the clear
  const smtp = smtpRefusal(account)
  if (smtp) return `Konto ${account.id}: ${smtp}`
  return null
}

/**
 * I6 (MR-20): why the SMTP settings would send the password in the clear, or null. Host-based like
 * the IMAP check in `accounts.ts`: only the loopback sandbox may log in without encryption.
 */
export function smtpRefusal(account: Pick<WriteAccount, 'smtpHost' | 'security' | 'smtpSecurity'>): string | null {
  if (smtpSecurityOf(account) === 'none' && !allowsPlainLogin(account.smtpHost)) {
    return 'Der SMTP-Server braucht eine Verschlüsselung (SSL/TLS oder STARTTLS).'
  }
  return null
}

/**
 * I6 (MR-20): why main refuses to SAVE an account with these settings, or null.
 *
 * The renderer offers the sandbox kind only in a development build, but main used to accept
 * whatever it was sent. A sandbox-kind account gets the write path, so off the loopback
 * allowlist it is accepted only as the canary; anything else is a real mailbox and is saved
 * as read-only. The SMTP check holds for every kind: a cleartext login is never right.
 */
export function settingsRefusal(account: WriteAccount): string | null {
  const smtp = smtpRefusal(account)
  if (smtp) return smtp
  if (account.kind === 'sandbox' && !isCanary(account) &&
    (!isSandboxHost(account.imapHost) || !isSandboxHost(account.smtpHost))) {
    return 'Ein echtes Postfach ohne Freigabe als Testpostfach kann nur gelesen werden (Art „Nur lesen“).'
  }
  return null
}

/**
 * A7 part 2: why this send may not go out, or null when it may.
 *
 * The canary is a real mailbox, so its mail leaves the machine. Phase 1 of the canary
 * is the user's own address only - never another person - so every recipient must be
 * the account's own address. Sandbox accounts are unrestricted here: they reach a local
 * sink that keeps nothing.
 */
export function sendRefusal(
  account: WriteAccount,
  recipients: string[]
): string | null {
  if (!isCanary(account)) return null
  const own = (account.email ?? '').trim().toLowerCase()
  if (!own) {
    return `Konto ${account.id}: eigene Adresse fehlt, Versand gesperrt.`
  }
  const foreign = recipients
    .map((to) => to.trim().toLowerCase())
    .filter((to) => to !== own)
  if (foreign.length) {
    return `Konto ${account.id}: Testpostfach sendet nur an die eigene Adresse.`
  }
  return null
}

/** Throws unless this account may be written to */
export function assertWriteAllowed(account: WriteAccount): void {
  const refusal = writeRefusal(account)
  if (refusal) throw new Error(`WRITE GUARD: ${refusal}`)
}

/**
 * TLS: `rejectUnauthorized` may be false ONLY on the loopback allowlist, where the
 * certificate is the test server's own. Anywhere else the default (verify) stays.
 */
export function tlsOptions(host: string): { rejectUnauthorized: boolean; servername?: string } {
  return isSandboxHost(host)
    ? { rejectUnauthorized: false, servername: host }
    : { rejectUnauthorized: true }
}

/** The IMAP client a write uses: this account's endpoint, TLS only relaxed on loopback */
export async function connectWriteImap(
  account: WriteAccount,
  credentials: { user: string; pass: string }
): Promise<ImapFlow> {
  assertWriteAllowed(account);
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.security === 'tls',
    doSTARTTLS: account.security === 'starttls',
    auth: { user: credentials.user, pass: credentials.pass },
    logger: false,
    emitLogs: false,
    // I15a (MR-19): the sync engine's limits; without socketTimeout imapflow waited ~5 min on a
    // half-open socket before the op failed
    ...IMAP_TIMEOUTS,
    ...(isSandboxHost(account.imapHost) ? { tls: tlsOptions(account.imapHost) } : {}),
  });
  // After connect() a dead socket is reported as an 'error' event, which throws in the worker
  // without a listener. The client is unusable by then and the pool replaces it.
  client.on('error', () => { /* the op in flight fails on its own; nothing to add here */ });
  await client.connect();
  return client;
}

/**
 * A7: the SMTP encryption of an account. Accounts saved before the setting existed
 * fall back to the IMAP security, which is right for the sandbox (both are 'none')
 * and conservative for anything else (TLS on both sides rather than cleartext).
 */
export function smtpSecurityOf(account: Pick<WriteAccount, 'security' | 'smtpSecurity'>): ImapSecurity {
  return account.smtpSecurity ?? account.security
}

/** The SMTP transport a write uses: this account's endpoint, TLS only relaxed on loopback */
export function writeSmtp(
  account: WriteAccount,
  credentials: { user: string; pass: string }
) {
  assertWriteAllowed(account);
  const security = smtpSecurityOf(account);
  const transport = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: security === 'tls',
    ...(security === 'starttls' ? { requireTLS: true } : {}),
    ...(isSandboxHost(account.smtpHost) ? { tls: tlsOptions(account.smtpHost) } : {}),
    // A7: the server authenticates the sender. Without this the sandbox still works
    // (Mailpit accepts anything) and every real server refuses with 530/535.
    auth: { user: credentials.user, pass: credentials.pass },
  });
  return transport;
}

/** Pre-flight check: whether this account's IMAP server answers right now */
export async function writeEndpointReachable(account: WriteAccount): Promise<boolean> {
  if (writeRefusal(account)) return false;
  return new Promise((resolve) => {
    const sock = net.connect(account.imapPort, account.imapHost);
    sock.setTimeout(1500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
  });
}
