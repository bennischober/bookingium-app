// Task 5: server-side remote-image fetch (opt-in "load images" feature), extracted
// from the HTTP server into the core. Pure data: URL → data: URI map, size/type
// limited. The HOST decides whether to offer this feature at all (privacy).
// No mail content is logged.
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

export interface RemoteImageFetchOptions {
  maxBytesPerImage?: number;     // default 5 MB
  maxTotalBytes?: number;        // default 30 MB
  maxImagesPerRequest?: number;  // default 50
  timeoutMs?: number;            // default 10 s per image, body included
  userAgent?: string;            // default 'mail-client-prototype; image-load'
  /** How many images are fetched at once; default 6 */
  concurrency?: number;
  /** Called after each image settles (loaded or not), for a progress indicator */
  onProgress?: (done: number, total: number) => void;
  /**
   * I11 (MR-22): the addresses never connected to, on the first request and every redirect hop.
   * Default `isPrivateAddress`: a mail must not make this machine probe the router or a service
   * on localhost. Tests replace it to reach their loopback server.
   */
  blockedAddress?: (address: string) => boolean;
}

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|x-icon)$/;

/** I11 (MR-22): a redirect chain longer than this is dropped */
const MAX_REDIRECTS = 5;

/**
 * Addresses a remote image must never reach. BlockList checks an IPv4-mapped IPv6 address
 * (::ffff:127.0.0.1) against the IPv4 rules itself; a ::ffff:0:0/96 rule here would instead
 * match EVERY IPv4 address, so there is none.
 */
const PRIVATE = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) PRIVATE.addSubnet(address, prefix, 'ipv6');

/** I11 (MR-22): loopback, private, link-local, multicast or reserved; anything unparsable too */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  return PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

const blocked = (): NodeJS.ErrnoException =>
  Object.assign(new Error('address not allowed'), { code: 'EADDRBLOCKED' });

/**
 * I11 (MR-22): the address check sits INSIDE the connection's own DNS lookup, so the address
 * that is checked is the address that is connected to - a second lookup could answer
 * differently (DNS rebinding). Every answer must pass, not just the first.
 */
const guardedLookup = (isBlocked: (address: string) => boolean): net.LookupFunction => (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    const list = (addresses ?? []) as unknown as dns.LookupAddress[];
    const error = err ?? (list.length === 0 || list.some(a => isBlocked(a.address)) ? blocked() : null);
    if (error) {
      if (options.all) callback(error, []);
      else callback(error, '', 0);
      return;
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
};

function request(url: URL, signal: AbortSignal, userAgent: string, isBlocked: (address: string) => boolean): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: 'GET',
      headers: { 'User-Agent': userAgent, Accept: 'image/*' },
      signal,
      lookup: guardedLookup(isBlocked),
    });
    req.on('response', resolve);
    req.on('error', reject);
    req.end();
  });
}

/** The literal-IP part of a URL host; a name is checked in `guardedLookup` instead */
function literalAddress(hostname: string): string | null {
  const bare = hostname.replace(/^\[|\]$/g, '');
  return net.isIP(bare) ? bare : null;
}

/**
 * One image, redirects followed by hand so every hop is checked, the body read under a byte cap.
 * null for anything that is not a small image from a public host.
 */
async function fetchImage(
  url: string,
  signal: AbortSignal,
  cap: () => number,
  userAgent: string,
  isBlocked: (address: string) => boolean,
): Promise<{ type: string; body: Buffer } | null> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return null;
    // A literal IP connects without a lookup, so it is checked here
    const literal = literalAddress(current.hostname);
    if (literal && isBlocked(literal)) return null;

    const res = await request(current, signal, userAgent, isBlocked);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      current = new URL(res.headers.location, current);
      continue;
    }
    if (status < 200 || status >= 300) { res.destroy(); return null; }
    // Content-Type is case-insensitive per RFC 9110, so "IMAGE/PNG" is a real png. Comparing it
    // as-is silently dropped a legitimate image; the type is normalised before the allowlist runs.
    const type = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(type)) { res.destroy(); return null; }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > cap()) { res.destroy(); return null; }

    // The deadline covers the body: the request carries the signal, and aborting it destroys the
    // response with an error, so a server that sends headers and then trickles makes the loop
    // below throw rather than end on a short body.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
      size += (chunk as Buffer).length;
      // Streamed, so a body larger than the cap is never held in memory whole
      if (size > cap()) { res.destroy(); return null; }
      chunks.push(chunk as Buffer);
    }
    return { type, body: Buffer.concat(chunks, size) };
  }
  return null;
}

/**
 * Fetch the given image URLs and return data: URIs. Unreachable/oversized/non-image
 * URLs are simply absent from the result (the caller keeps them blocked).
 *
 * The fetches run CONCURRENTLY. Sequentially, one await per image meant the total was the
 * sum of every host's latency: measured 1279 ms for 10 images at 120 ms each, and a marketing
 * mail with 72 images spent most of its time waiting on nothing. With a bounded pool the same work
 * is one round-trip per batch instead of one per image.
 *
 * The bound matters: a mail can reference hundreds of hosts, and an unbounded fan-out would open as
 * many sockets as there are images. Six keeps the mailbox from being a load generator while still
 * hiding the latency.
 *
 * The timeout is per image and covers the whole body (I11, MR-22), so one dead or trickling host
 * costs its own slot rather than stalling the rest.
 */
export async function fetchRemoteImagesAsDataUris(
  urls: string[],
  opts: RemoteImageFetchOptions = {},
): Promise<Map<string, string>> {
  const maxPer = opts.maxBytesPerImage ?? 5 * 1024 * 1024;
  const maxTotal = opts.maxTotalBytes ?? 30 * 1024 * 1024;
  const maxCount = opts.maxImagesPerRequest ?? 50;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const userAgent = opts.userAgent ?? 'Mozilla/5.0 (mail-client-prototype; image-load)';
  const isBlocked = opts.blockedAddress ?? isPrivateAddress;
  const wanted = urls.slice(0, maxCount);
  const out = new Map<string, string>();
  // One budget for the whole request. The check-and-add below runs with no await between
  // them, so concurrent fetches cannot overshoot it: a late arrival that no longer fits is
  // dropped, never added.
  let total = 0;
  let done = 0;
  // While streaming, an image may grow up to its own cap or what is left of the budget
  const cap = () => Math.min(maxPer, maxTotal - total);

  const loadOne = async (url: string): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (total >= maxTotal) return;
      const image = await fetchImage(url, controller.signal, cap, userAgent, isBlocked);
      if (!image) return;
      if (image.body.length > maxPer) return;
      // the budget is a cap, not a threshold to cross
      if (total + image.body.length > maxTotal) return;
      total += image.body.length;
      out.set(url, `data:${image.type};base64,${image.body.toString('base64')}`);
    } catch {
      // unreachable/blocked/timeout: leave blocked
    } finally {
      clearTimeout(timer);
      done += 1;
      opts.onProgress?.(done, wanted.length);
    }
  };

  // A worker per slot pulls the next URL until the list is empty, which keeps exactly
  // `concurrency` fetches in flight without spawning one promise per image.
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const url = wanted[next++];
      await loadOne(url);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, worker));
  return out;
}
