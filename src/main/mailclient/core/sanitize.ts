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
//    They are read by the HTML parser and hold no "<" afterwards (MR-07).
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

/**
 * H5b: the fallback a receiving client would also choose.
 *
 * Without it the iframe rendered in the browser's default serif at the default size,
 * while the editor is the app's sans-serif - so a mail sent to yourself looked nothing
 * like what was typed. Four properties only: margin, font, size, line-height. Anything
 * more would start overriding the mail's own CSS, which follows this block in the head.
 */
export const MAIL_BASE_STYLE =
  'body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; }';

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

/** DOMPurify strips a dangerous href entirely; this copy keeps the URL for display */
const RAW_HREF = 'data-raw-href';

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
  'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'valign', RAW_HREF,
];

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const purify = DOMPurify(dom.window as unknown as Parameters<typeof DOMPurify>[0]);

// DOMPurify removes the href of javascript:/data:/vbscript: links entirely (its own
// URL safety check), which would lose the URL a blocked link pointed at. This hook runs
// BEFORE that check and keeps a copy on data-raw-href. The dangerous href itself is still
// dropped by DOMPurify - only the copy the UI displays survives.
purify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName !== 'href' || node.nodeName !== 'A') return;
  // Only a URL DOMPurify would drop needs the copy
  if (isUnsafeLinkScheme(data.attrValue)) node.setAttribute(RAW_HREF, data.attrValue);
});

/**
 * Scheme extraction the way browsers effectively parse it: strip control chars and
 * whitespace (tab/newline/CR are ignored anywhere in a URL), then read the scheme.
 * "jav\tascript:alert(1)" → "javascript".
 */
function schemeOf(rawUrl: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately strips C0 controls (\x00-\x20) and DEL: browsers ignore them inside a URL scheme, which is exactly the smuggling vector this guard must model
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
      // A protocol-relative "//host/path" has NO scheme, so schemeOf() returns '' - the same as a
      // local "bild.png". The browser resolves it against the document's scheme and loads it, so
      // treating it as local kept a working tracker. It is remote; only a path that stays inside
      // this document is local.
      if (u.trim().startsWith('//')) return 'url(about:blank)';
      if (!scheme || scheme === 'data' || scheme === 'blob') return match;
      return 'url(about:blank)';
    });
}

/**
 * MR-07: CSS goes back into the document as the text of a <style> element, which a browser
 * reads up to the first "</style". The HTML serializer does not escape that text, so the CSS
 * must hold no "<" at all. The comment markers Outlook wraps its CSS in are ignored by CSS
 * anyway; any other "<" can only sit in a string or a selector, where the escape \3c reads
 * the same.
 */
function cssWithoutMarkup(css: string): string {
  return css.replace(/<!--|-->/g, '').replace(/</g, '\\3c ');
}

/**
 * The mail's <style> blocks, read the way a browser parses the mail, and the mail without them.
 * A style inside <svg> or <math> is foreign content, so its entities decode into its text: an
 * "&lt;" there is a real "<" here, which cssWithoutMarkup escapes like any other. Removing the
 * elements is belt and braces: DOMPurify also drops a <style> with its text.
 */
function liftStyleBlocks(rawHtml: string): { styleBlocks: string[]; rest: string } {
  const doc = new dom.window.DOMParser().parseFromString(rawHtml, 'text/html');
  const styleBlocks: string[] = [];
  for (const el of [...doc.querySelectorAll('style')]) {
    styleBlocks.push(cssWithoutMarkup(neutralizeCssUrls(el.textContent ?? '')));
    el.remove();
  }
  return { styleBlocks, rest: doc.body ? doc.body.innerHTML : '' };
}

export function sanitizeEmailHtml(rawHtml: string): SanitizeResult {
  const links: SanitizeLink[] = [];
  const remoteImages: SanitizeRemoteImage[] = [];

  // 1. DOMPurify: structural whitelist. ALLOW_UNKNOWN_PROTOCOLS keeps href values for
  //    non-http schemes so we can classify them ourselves (and show them as blocked).
  //    A <style> block is lifted out first: DOMPurify drops its text content entirely,
  //    so the CSS is neutralized here and put back below.
  //    I5/MR-07: lifted out by the HTML parser, not a regex. A regex read up to the next
  //    "</style>", while a browser also closes the block at "</style >" or "</STYLE\t>", so
  //    the markup in between skipped DOMPurify and came back live in the reading pane.
  const { styleBlocks, rest } = liftStyleBlocks(rawHtml);
  const cleaned = purify.sanitize(rest, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_UNKNOWN_PROTOCOLS: true,
    KEEP_CONTENT: true,
  }) as string;

  // 2. post-process in jsdom
  const doc = new JSDOM(cleaned).window.document;

  // <style> blocks: neutralize url()/@import (CSP also blocks remote loads, belt & braces)
  for (const css of styleBlocks) {
    const styleEl = doc.createElement('style');
    styleEl.textContent = css;
    doc.head.appendChild(styleEl);
  }

  // anchors → classify + rewrite. A blocked link may have lost its href in step 1,
  // so the pre-step-1 copy is what classifies it.
  const anchors = [...doc.querySelectorAll('a')];
  for (const a of anchors) {
    const rawHref = a.getAttribute('data-raw-href') || a.getAttribute('href') || '';
    const scheme = schemeOf(rawHref);
    const openable = !isUnsafeLinkScheme(rawHref);
    const idx = links.length;
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    links.push({ index: idx, text, url: rawHref, scheme, openable });
    a.setAttribute('data-link-idx', String(idx));
    a.removeAttribute('data-raw-href');
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
  // The mail's own <style> blocks travel into the head, after the app's own
  const styles = styleBlocks.map((css) => `<style>${css}</style>`).join('');
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}">
<style>${MAIL_BASE_STYLE}</style>
${styles}
</head>
<body>${body}</body>
</html>`;

  return { html, links, remoteImages };
}
