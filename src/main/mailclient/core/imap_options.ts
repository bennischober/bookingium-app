// Connection settings shared by the sync engine and the one-shot connection test.
import type { ImapSecurity } from './types.js';

/** Limits for every IMAP connection, so a wrong port or a dead server fails within seconds
 * instead of dangling. A connection that idles is not cut by socketTimeout: imapflow probes it
 * with NOOP first and only fails it when that goes unanswered. */
export const IMAP_TIMEOUTS = {
  connectionTimeout: 15_000,   // TCP (and TLS) handshake
  greetingTimeout: 10_000,     // the server's "* OK" after that
  socketTimeout: 120_000,      // silence in the middle of a command
} as const;

/** imapflow's options for an encryption setting. STARTTLS is required when chosen, never
 * opportunistic: a server that does not offer it fails instead of logging in in the clear. */
export function imapSecurityOptions(security: ImapSecurity): { secure: boolean; doSTARTTLS: boolean } {
  return { secure: security === 'tls', doSTARTTLS: security === 'starttls' };
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** Whether a login without encryption is acceptable: only to this machine (a local test server
 * or a tunnel), where the password never crosses a network. */
export function allowsPlainLogin(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/** The server rejected the user name or password (imapflow marks LOGIN/AUTHENTICATE failures). */
export function isAuthFailure(err: unknown): boolean {
  return typeof err === 'object' && err !== null
    && (err as { authenticationFailed?: unknown }).authenticationFailed === true;
}
