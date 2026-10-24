// Write-guard: ALL IMAP/SMTP write operations live here, and this module decides
// PER ACCOUNT whether a write may go out. The loopback allowlist is fixed and the
// decision is made from the account itself - no global "the sandbox" anymore.
//
// A7 part 1: an account may be written to only if it is a sandbox account AND both
// its IMAP and SMTP hosts are on the loopback allowlist. Nothing else is allowed.
// Part 2 (the canary mailbox) is a user decision and not implemented.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import net from 'net';
import type { ImapSecurity } from './types.js';

export const SANDBOX_ALLOWLIST = new Set([
  '127.0.0.1', 'localhost', '::1',
  'sandbox-dovecot', 'sandbox-mailpit',   // docker-internal names
]);

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
 * Part 1 admits sandbox accounts on the loopback allowlist only. A production
 * account is read-only by design, and a sandbox account pointed at a real server
 * is refused rather than trusted.
 */
export function writeRefusal(account: WriteAccount): string | null {
  if (account.kind !== 'sandbox') {
    return `Konto ${account.id} ist schreibgeschützt.`
  }
  if (!isSandboxHost(account.imapHost) || !isSandboxHost(account.smtpHost)) {
    return `Konto ${account.id}: Schreiben ist nur gegen den lokalen Testserver erlaubt.`
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
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    ...(isSandboxHost(account.imapHost) ? { tls: tlsOptions(account.imapHost) } : {}),
  });
  await client.connect();
  return client;
}

/** The SMTP transport a write uses: this account's endpoint, TLS only relaxed on loopback */
export function writeSmtp(account: WriteAccount) {
  assertWriteAllowed(account);
  const transport = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.security === 'tls',
    ...(account.security === 'starttls' ? { requireTLS: true } : {}),
    ...(isSandboxHost(account.smtpHost) ? { tls: tlsOptions(account.smtpHost) } : {}),
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
