// Write-guard: ALL IMAP/SMTP write operations live here, and this module decides
// PER ACCOUNT whether a write may go out, from the account itself.
//
// One account kind (2026-10-28, before the merge): every account is writable unless the user
// set it to "Nur lesen". The sandbox, the read-only production kind and the canary (one real
// mailbox, sends to its own address only) are gone; the user lifted their accounts to writable.
// What stays fixed:
//   - a read-only account never gets a write, checked before an op is journaled and again when
//     it connects;
//   - no login in the clear off loopback, IMAP or SMTP - checked when an account is saved
//     (`settingsRefusal`) and before every write (`writeRefusal`);
//   - certificate checks are relaxed on the loopback allowlist only (the local test server).
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

/** What the write guard needs to know about one account */
export interface WriteAccount {
  id: string;
  /** "Nur lesen": the app reads this mailbox and writes nothing to it */
  readOnly: boolean;
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

/**
 * The reason an account may not be written to, or null when it may: it is set to "Nur lesen",
 * or its settings would log in without encryption across a network (an account stored before
 * main checked that).
 */
export function writeRefusal(account: WriteAccount): string | null {
  if (account.readOnly) {
    return `Konto ${account.id} ist auf „Nur lesen“ gestellt.`;
  }
  const settings = settingsRefusal(account);
  if (settings) return `Konto ${account.id}: ${settings}`;
  return null;
}

/**
 * I6 (MR-20): why the SMTP settings would send the password in the clear, or null. Host-based like
 * the IMAP check: only the loopback test server may log in without encryption.
 */
export function smtpRefusal(account: Pick<WriteAccount, 'smtpHost' | 'security' | 'smtpSecurity'>): string | null {
  if (smtpSecurityOf(account) === 'none' && !allowsPlainLogin(account.smtpHost)) {
    return 'Der SMTP-Server braucht eine Verschlüsselung (SSL/TLS oder STARTTLS).'
  }
  return null
}

/**
 * I6 (MR-20): why main refuses to SAVE an account with these settings, or null: a password in the
 * clear across a network, on the IMAP or the SMTP side. Read-only accounts too - the IMAP login
 * is the same either way, and a read-only account may be made writable later.
 */
export function settingsRefusal(
  account: Pick<WriteAccount, 'imapHost' | 'security' | 'smtpHost' | 'smtpSecurity'>
): string | null {
  if (account.security === 'none' && !allowsPlainLogin(account.imapHost)) {
    return 'Ein echtes Postfach braucht eine Verschlüsselung (SSL/TLS oder STARTTLS).'
  }
  return smtpRefusal(account)
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
 * fall back to the IMAP security, which is right for the local test server (both are 'none')
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
    // A7: the server authenticates the sender. Without this the local test server still works
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
