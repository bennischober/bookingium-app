// One-shot connection check for account setup ("Verbindung testen"): connect, log in, count
// the folders, log out. Exactly one attempt within a hard deadline, never a retry, so a wrong
// password is sent once and a wrong port answers within seconds instead of dangling.
import { ImapFlow } from 'imapflow';
import { IMAP_TIMEOUTS, imapSecurityOptions, isAuthFailure } from './imap_options.js';
import type { ImapSecurity } from './types.js';

/** Where the attempt stopped, so the host can say what to change:
 *  - dns: host name unknown
 *  - refused: host reachable, nothing listens on this port
 *  - unreachable: no answer at all (offline, firewall, wrong host)
 *  - greeting: connected, but no IMAP greeting (wrong port, or the server expects TLS)
 *  - tls: TLS handshake failed (the server does not speak TLS on this port)
 *  - certificate: the server's certificate is not trusted
 *  - starttls: STARTTLS chosen, but the server does not offer it
 *  - auth: user name or password rejected
 *  - timeout: the whole check took longer than its deadline
 *  - other: anything else; the message says what */
export type ConnectionTestStage =
  | 'dns' | 'refused' | 'unreachable' | 'greeting' | 'tls' | 'certificate' | 'starttls' | 'auth'
  | 'timeout' | 'other';

export type ConnectionTestResult =
  | { ok: true; folderCount: number; ms: number }
  | { ok: false; stage: ConnectionTestStage; message: string; ms: number };

export type ConnectionTestInput = {
  host: string;
  port: number;
  security: ImapSecurity;
  user: string;
  pass: string;
};

const CERTIFICATE_CODES = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function classifyConnectionError(err: unknown): ConnectionTestStage {
  if (isAuthFailure(err)) return 'auth';
  const e = (err ?? {}) as { code?: unknown; message?: unknown; tlsFailed?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.tlsFailed === true) return 'starttls';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'ECONNREFUSED') return 'refused';
  if (['CONNECT_TIMEOUT', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return 'unreachable';
  if (code === 'GREETING_TIMEOUT') return 'greeting';
  if (CERTIFICATE_CODES.has(code)) return 'certificate';
  if (code === 'EPROTO' || code.startsWith('ERR_SSL') || /wrong version number|ssl3_get_record|tls/i.test(message)) {
    return 'tls';
  }
  return 'other';
}

/** Connects once, logs in, counts the folders and logs out, all within `timeoutMs`. */
export async function testImapConnection(input: ConnectionTestInput, opts: { timeoutMs?: number } = {}):
  Promise<ConnectionTestResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const started = Date.now();
  const ms = () => Date.now() - started;
  const client = new ImapFlow({
    host: input.host,
    port: input.port,
    ...imapSecurityOptions(input.security),
    auth: { user: input.user, pass: input.pass },
    logger: false, emitLogs: false,
    connectionTimeout: Math.min(IMAP_TIMEOUTS.connectionTimeout, timeoutMs),
    greetingTimeout: Math.min(IMAP_TIMEOUTS.greetingTimeout, timeoutMs),
    socketTimeout: timeoutMs,
  });
  // errors after connect() arrive as events; the attempt below already reports them
  client.on('error', () => { });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ConnectionTestResult>(resolve => {
    timer = setTimeout(() => resolve({
      ok: false, stage: 'timeout', message: `no result within ${Math.round(timeoutMs / 1000)} s`, ms: ms(),
    }), timeoutMs);
  });
  const attempt = (async (): Promise<ConnectionTestResult> => {
    try {
      await client.connect();
      const folders = await client.list();
      await client.logout().catch(() => { });
      return { ok: true, folderCount: folders.length, ms: ms() };
    } catch (err) {
      return { ok: false, stage: classifyConnectionError(err), message: (err as Error)?.message ?? String(err), ms: ms() };
    }
  })();
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
    // ends a hung attempt too; close() is a no-op on a connection that already logged out
    try { client.close(); } catch { }
  }
}
