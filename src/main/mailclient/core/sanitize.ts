// HTML mail sanitization for safe rendering (Task 2 security requirements).
// Task 5 core-boundary note: THIS MODULE is the only part of the core that needs
// jsdom + DOMPurify. In an Electron host without jsdom-friendly globals it still
// works as-is (jsdom is pure JS, no DOM globals required at import time — the JSDOM
// instance is created here, not taken from `window`). If a host wants to drop the
// jsdom dependency, only this file must be swapped.
//
// Output contract (the reading pane iframe gets exactly this):
//  - iframe attributes: sandbox="allow-popups allow-popups-to-escape-sandbox"
//    (NO allow-same-origin, NO allow-scripts — per requirement; allow-popups is needed
//    because without scripts the parent cannot intercept clicks inside the iframe, so
//    openable links carry their real URL + target="_blank" and the browser opens them
//    in a real tab = "system browser". Unsafe schemes are NOT given a real href.)
//  - CSP via <meta http-equiv>: default-src 'none'; img-src data: blob:;
//    style-src 'unsafe-inline'; font-src data:
//  - anchors: openable (http/https/mailto) → href = real URL, target=_blank.
//    javascript:/file:/data:/vbscript:/everything else → href="#", class="mail-link-blocked",
//    title="blocked: <scheme>". Both kinds appear in the returned links manifest with
//    the ORIGINAL url so the UI can display it visibly.
//  - images: remote http(s) → neutral placeholder + remoteImages manifest (opt-in reload);
//    cid: → placeholder + data-cid (UI resolves from local attachments); data:/blob: kept.
//  - <style> blocks kept (email fidelity) but url(http...) neutralized, @import removed.
//  - style attributes: url(http...) neutralized.
//  - killed entirely: script, iframe, object, embed, form, video, audio, meta, link,
//    base, svg, math, all on* handlers.
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const REMOTE_IMG_PLACEHOLDER = 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#e5e7eb"/><text x="60" y="25" font-family="sans-serif" font-size="11" fill="#6b7280" text-anchor="middle">blocked</text></svg>`
).toString('base64');

export const MAIL_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";
export const MAIL_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

export interface SanitizeLink {
  index: number;
  text: string;
  url: string;        // ORIGINAL url (for display)
  scheme: string;
  openable: boolean;
}

export interface SanitizeRemoteImage {
  url: string;
  placeholder: string;
}

export interface SanitizeResult {
  html: string;
  links: SanitizeLink[];
  remoteImages: SanitizeRemoteImage[];
}

const ALLOWED_TAGS = [
  'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'big',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'caption', 'colgroup', 'col', 'a', 'img', 'blockquote', 'pre', 'code',
  'font', 'center', 'address', 'article', 'aside', 'section', 'header', 'footer',
  'style',
];
const ALLOWED_ATTR = [
  'style', 'class', 'id', 'align', 'width', 'height', 'color', 'face', 'size',
  'bgcolor', 'dir', 'lang', 'title', 'href', 'src', 'alt', 'border',
  'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'valign',
];

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const purify = DOMPurify(dom.window as unknown as Parameters<typeof DOMPurify>[0]);

/**
 * Scheme extraction the way browsers effectively parse it: strip control chars and
 * whitespace (tab/newline/CR are ignored anywhere in a URL), then read the scheme.
 * "jav\tascript:alert(1)" → "javascript".
 */
function schemeOf(rawUrl: string): string {
  const cleaned = rawUrl.replace(/[\x00-\x20\x7f]/g, '');
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  return m ? m[1].toLowerCase() : '';
}

export function isUnsafeLinkScheme(rawUrl: string): boolean {
  const scheme = schemeOf(rawUrl);
  if (!scheme) return false;                       // relative/fragment: not openable externally
  return !(scheme === 'http' || scheme === 'https' || scheme === 'mailto');
}

/** Neutralize url(...) references (keep data:) inside CSS text. */
function neutralizeCssUrls(css: string): string {
  return css
    .replace(/@import[^;]+;?/gi, '/* @import removed */')
    .replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (match, _q, u: string) => {
      const scheme = schemeOf(u);
      if (!scheme || scheme === 'data' || scheme === 'blob') return match;
      return 'url(about:blank)';
    });
}

export function sanitizeEmailHtml(rawHtml: string): SanitizeResult {
  const links: SanitizeLink[] = [];
  const remoteImages: SanitizeRemoteImage[] = [];

  // 1. DOMPurify: structural whitelist. ALLOW_UNKNOWN_PROTOCOLS keeps href values for
  //    non-http schemes so we can classify them ourselves (and show them as blocked).
  const cleaned = purify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_UNKNOWN_PROTOCOLS: true,
    KEEP_CONTENT: true,
  }) as string;

  // 2. post-process in jsdom
  const doc = new JSDOM(cleaned).window.document;

  // <style> blocks: neutralize url()/@import (CSP also blocks remote loads, belt & braces)
  for (const styleEl of [...doc.querySelectorAll('style')]) {
    if (styleEl.textContent) styleEl.textContent = neutralizeCssUrls(styleEl.textContent);
  }

  // anchors → classify + rewrite
  const anchors = [...doc.querySelectorAll('a[href]')];
  for (const a of anchors) {
    const rawHref = a.getAttribute('href') || '';
    const scheme = schemeOf(rawHref);
    const openable = !isUnsafeLinkScheme(rawHref);
    const idx = links.length;
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    links.push({ index: idx, text, url: rawHref, scheme, openable });
    a.setAttribute('data-link-idx', String(idx));
    if (openable) {
      a.setAttribute('href', rawHref);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.setAttribute('title', rawHref.slice(0, 300));   // real URL visible on hover
    } else {
      a.setAttribute('href', '#');
      a.setAttribute('class', `mail-link-blocked ${a.getAttribute('class') || ''}`.trim());
      a.setAttribute('title', `blocked link (${scheme || 'no scheme'})`);
    }
  }

  // images
  const imgs = [...doc.querySelectorAll('img')];
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    const style = img.getAttribute('style');
    if (style) img.setAttribute('style', neutralizeCssUrls(style));
    if (src.startsWith('data:') || src.startsWith('blob:')) continue;   // local, CSP allows
    if (src.startsWith('cid:')) {
      img.setAttribute('src', REMOTE_IMG_PLACEHOLDER);
      img.setAttribute('data-cid', src.slice(4));
      img.setAttribute('alt', img.getAttribute('alt') || 'inline image');
      continue;
    }
    if (src) {
      const scheme = schemeOf(src);
      const isHttpRemote = scheme === 'http' || scheme === 'https' || (scheme === '' && src.startsWith('//'));
      if (isHttpRemote) {
        remoteImages.push({ url: src, placeholder: REMOTE_IMG_PLACEHOLDER });
        img.setAttribute('data-remote-src', src);
      }
      img.setAttribute('src', REMOTE_IMG_PLACEHOLDER);
      img.setAttribute('alt', img.getAttribute('alt') || 'remote image blocked');
    } else {
      img.removeAttribute('src');
    }
  }

  // style attributes (all elements): neutralize url()
  for (const el of [...doc.querySelectorAll('[style]')]) {
    const s = el.getAttribute('style');
    if (s && /url\(/i.test(s)) el.setAttribute('style', neutralizeCssUrls(s));
  }

  // 3. serialize + wrap in a CSP document
  const body = doc.body ? doc.body.innerHTML : '';
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}">
<style>/* mail content styles live in the app, not here */</style>
</head>
<body>${body}</body>
</html>`;

  return { html, links, remoteImages };
}
