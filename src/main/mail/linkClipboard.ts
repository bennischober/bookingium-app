/**
 * Which link addresses from a mail may be put on the clipboard.
 *
 * The scheme allowlist is the same one the window-open handler uses (main/index.ts): http, https, mailto.
 * A mail can carry a link we would never open, and "copy" must not become a side door that hands the user a
 * file:// path or a javascript: URL to paste somewhere that does execute it. Copying is a lower-risk action
 * than opening, but it is not a safe action.
 *
 * Pure on purpose: no electron import, so the rule is testable in the node test env.
 */
const COPYABLE_SCHEMES = ['http:', 'https:', 'mailto:']

export type CopyableLink = { ok: true; url: string } | { ok: false; error: string }

export function copyableLinkUrl(rawUrl: string): CopyableLink {
  let protocol: string
  try {
    protocol = new URL(rawUrl).protocol
  } catch {
    return { ok: false, error: 'Keine gültige Adresse' }
  }
  if (!COPYABLE_SCHEMES.includes(protocol)) {
    return { ok: false, error: `Schema ${protocol} wird nicht kopiert` }
  }
  return { ok: true, url: rawUrl }
}
