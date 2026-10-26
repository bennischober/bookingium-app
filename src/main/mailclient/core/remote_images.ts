// Task 5: server-side remote-image fetch (opt-in "load images" feature), extracted
// from the HTTP server into the core. Pure data: URL → data: URI map, size/type
// limited. The HOST decides whether to offer this feature at all (privacy).
// No mail content is logged.

export interface RemoteImageFetchOptions {
  maxBytesPerImage?: number;     // default 5 MB
  maxTotalBytes?: number;        // default 30 MB
  maxImagesPerRequest?: number;  // default 50
  timeoutMs?: number;            // default 10 s per image
  userAgent?: string;            // default 'mail-client-prototype; image-load'
  /** How many images are fetched at once; default 6 */
  concurrency?: number;
  /** Called after each image settles (loaded or not), for a progress indicator */
  onProgress?: (done: number, total: number) => void;
}

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|x-icon)$/;

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
 * The timeout is per image, so one dead host costs its own slot rather than stalling the rest.
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
  const wanted = urls.slice(0, maxCount);
  const out = new Map<string, string>();
  // One budget for the whole request. The check-and-add below runs with no await between
  // them, so concurrent fetches cannot overshoot it: a late arrival that no longer fits is
  // dropped, never added.
  let total = 0;
  let done = 0;

  const loadOne = async (url: string): Promise<void> => {
    try {
      if (total >= maxTotal) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': userAgent },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return;
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!IMAGE_TYPES.test(ct)) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxPer) return;
      // the budget is a cap, not a threshold to cross
      if (total + buf.length > maxTotal) return;
      total += buf.length;
      out.set(url, `data:${ct};base64,${buf.toString('base64')}`);
    } catch {
      // unreachable/blocked/timeout: leave blocked
    } finally {
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
