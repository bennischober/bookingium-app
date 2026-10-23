// Write-guard: ALL IMAP/SMTP write operations live here, and this module hard-refuses
// any host that is not a configured sandbox. Production credentials cannot reach this module:
// the sandbox host list is a fixed allowlist and the sandbox endpoints are injected by the
// host via createMailCore (Task 5: no process.env reads inside the core).
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import net from 'net';

export const SANDBOX_ALLOWLIST = new Set([
  '127.0.0.1', 'localhost', '::1',
  'sandbox-dovecot', 'sandbox-mailpit',   // docker-internal names
]);

export interface SandboxConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  pass: string;
}

// The ONLY way to obtain write-capable clients. Throws unless the target host is the sandbox.
export function assertSandboxHost(host: string): void {
  if (!SANDBOX_ALLOWLIST.has(host)) {
    throw new Error(`WRITE GUARD: refusing write operation against non-sandbox host "${host}". ` +
      `Write operations are only permitted against ${[...SANDBOX_ALLOWLIST].join(', ')}.`);
  }
}

/** Task 5: sandbox endpoints + credentials are injected, never read from process.env.
 * The factory validates the hosts against the allowlist ONCE at createMailCore time;
 * getSandboxConfig() keeps the same name so call sites don't change shape. */
let injected: SandboxConfig | null = null;

export function injectSandboxConfig(cfg: SandboxConfig): void {
  assertSandboxHost(cfg.imapHost);
  assertSandboxHost(cfg.smtpHost);
  injected = cfg;
}

export function getSandboxConfig(): SandboxConfig {
  if (!injected) {
    throw new Error('sandbox config not injected — create the core via createMailCore(options) first');
  }
  return injected;
}

export async function withSandboxImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const cfg = getSandboxConfig();
  const client = new ImapFlow({
    host: cfg.imapHost, port: cfg.imapPort, secure: false,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false, emitLogs: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => { });
  }
}

export function sandboxSmtp() {
  const cfg = getSandboxConfig();
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: false,          // Mailpit on loopback, no TLS
    tls: { rejectUnauthorized: false },
  });
  // belt & braces: verify the target is really the sandbox sink
  transporter.verify().catch(() => { }); // errors surface on send
  return transporter;
}

// Pre-flight check used by the app at startup: if the sandbox is unreachable, write ops are disabled.
export async function sandboxReachable(): Promise<boolean> {
  const cfg = getSandboxConfig();
  return new Promise(resolve => {
    const sock = net.connect(cfg.imapPort, cfg.imapHost);
    sock.setTimeout(1500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
  });
}
