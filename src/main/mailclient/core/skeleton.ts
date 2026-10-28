// S1: a large message without its large parts. From the server's BODYSTRUCTURE, the raw header
// sections, the bodies of the text parts and of the images an HTML body can show by Content-ID,
// rebuild a MIME message whose other leaves are empty (the skeleton). mailparser then reads the same
// headers, text, HTML (with its `cid:` images inlined as data: URLs), attachment list, part ids and
// Content-IDs as from the full message; only the attachment sizes are estimates from BODYSTRUCTURE
// until the message is completed. Pure: the caller fetches the sections.
import type { MessageStructureObject } from 'imapflow';

/** The types mailparser reads as body text when they are not marked as attachment (its createNode rule) */
const TEXT_TYPES = ['text/plain', 'text/html', 'message/delivery-status'];

/** One piece of the skeleton: literal bytes, or a section the caller fetched (`HEADER` is the message header) */
type Piece = { text: string } | { section: string; header: boolean };

/**
 * A leaf whose body the skeleton keeps: body text, or an image with a Content-ID, which
 * simpleParser inlines into the HTML for a matching `cid:` link whatever its disposition
 */
function keepsBody(node: MessageStructureObject): boolean {
  if (TEXT_TYPES.includes(node.type)) return !node.disposition || node.disposition === 'inline';
  return !!node.id && /^image\/\w+$/i.test(node.type);
}

/**
 * The skeleton's layout, or null for a structure it does not cover (no boundary, a top-level
 * message/rfc822, a missing part number): such a message is downloaded whole.
 */
function layout(root: MessageStructureObject): Piece[] | null {
  const pieces: Piece[] = [{ section: 'HEADER', header: true }];
  // `textSection` is where a leaf's own body is fetched: its part number, `TEXT` for a
  // single-part message, `<n>.TEXT` for the single body of an attached message
  const body = (node: MessageStructureObject, textSection: string): boolean => {
    if (node.type.startsWith('multipart/')) {
      const boundary = node.parameters?.boundary;
      if (!boundary || !node.childNodes?.length) return false;
      for (const child of node.childNodes) {
        if (!child.part) return false;
        pieces.push({ text: `--${boundary}\r\n` }, { section: `${child.part}.MIME`, header: true });
        if (!body(child, child.part)) return false;
        pieces.push({ text: '\r\n' });
      }
      pieces.push({ text: `--${boundary}--\r\n` });
      return true;
    }
    if (node.type === 'message/rfc822' && node.childNodes?.length) {
      if (!node.part) return false;
      const inner = node.childNodes[0];
      pieces.push({ section: `${node.part}.HEADER`, header: true });
      return body(inner, `${node.part}.TEXT`);
    }
    if (keepsBody(node)) pieces.push({ section: textSection, header: false });
    return true;
  };
  return body(root, 'TEXT') ? pieces : null;
}

/** The body sections to fetch for the skeleton (imapflow `bodyParts`; the message header comes with `headers: true`), or null */
export function skeletonSections(root: MessageStructureObject): string[] | null {
  const pieces = layout(root);
  if (!pieces) return null;
  return pieces.flatMap(p => ('section' in p && p.section !== 'HEADER' ? [p.section] : []));
}

/**
 * Assemble the skeleton from the message header and the fetched sections (keys as imapflow
 * returns them; case does not matter). Null when the structure is not covered or a section
 * is missing, so the caller downloads the whole message instead.
 */
export function buildSkeleton(root: MessageStructureObject, header: Buffer, sections: Map<string, Buffer>): Buffer | null {
  const pieces = layout(root);
  if (!pieces) return null;
  const byKey = new Map([...sections].map(([k, v]) => [k.toUpperCase(), v]));
  const out: Buffer[] = [];
  for (const p of pieces) {
    if ('text' in p) { out.push(Buffer.from(p.text, 'latin1')); continue; }
    const bytes = p.section === 'HEADER' ? header : byKey.get(p.section.toUpperCase());
    if (!bytes) return null;
    if (!p.header) { out.push(bytes); continue; }
    // a header section ends with its blank line; servers differ in how many CRLFs they keep
    let end = bytes.length;
    while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;
    out.push(bytes.subarray(0, end), Buffer.from('\r\n\r\n', 'latin1'));
  }
  return Buffer.concat(out);
}

/**
 * Estimated decoded size of each leaf and attached message, keyed like mailparser's `partId`
 * (`''` for a single-part message, as ingest stores a missing one). BODYSTRUCTURE gives the
 * encoded size: base64 in 76-character lines carries 57 bytes per 78.
 */
export function estimatedPartSizes(root: MessageStructureObject): Map<string, number> {
  const sizes = new Map<string, number>();
  const walk = (node: MessageStructureObject) => {
    const own = !node.childNodes?.length || node.type === 'message/rfc822';
    // the single body of an attached message reuses its part number; the message's size wins
    const key = node.part ?? '';
    if (own && node.size !== undefined && !sizes.has(key))
      sizes.set(key, node.encoding === 'base64' ? Math.round(node.size * 57 / 78) : node.size);
    node.childNodes?.forEach(walk);
  };
  walk(root);
  return sizes;
}
