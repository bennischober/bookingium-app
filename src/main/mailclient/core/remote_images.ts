// Task 5: server-side remote-image fetch (opt-in "load images" feature), extracted
// from the HTTP server into the core. Pure data: URL → data: URI map, size/type
// limited. The HOST decides whether to offer this feature at all (privacy).
// No mail content is logged.

export interface RemoteImageFetchOptions {
  maxBytesPerImage?: number;     // default 5 MB
  maxTotalBytes?: number;        // default 30 MB
  maxImagesPerRequest?: number;  // default 50
  timeoutMs?: number;            // default 10 s
  userAgent?: string;            // default 'mail-client-prototype; image-load'
}

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|x-icon|svg\+xml)$/;

/** Fetch the given image URLs and return data: URIs. Unreachable/oversized/non-image
 * URLs are simply absent from the result (the caller keeps them blocked). */
export async function fetchRemoteImagesAsDataUris(
  urls: string[],
  opts: RemoteImageFetchOptions = {},
): Promise<Map<string, string>> {
  const maxPer = opts.maxBytesPerImage ?? 5 * 1024 * 1024;
  const maxTotal = opts.maxTotalBytes ?? 30 * 1024 * 1024;
  const maxCount = opts.maxImagesPerRequest ?? 50;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const userAgent = opts.userAgent ?? 'Mozilla/5.0 (mail-client-prototype; image-load)';
  const out = new Map<string, string>();
  let total = 0;
  for (const url of urls.slice(0, maxCount)) {
    if (total > maxTotal) break;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': userAgent },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!IMAGE_TYPES.test(ct)) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxPer) continue;
      total += buf.length;
      out.set(url, `data:${ct};base64,${buf.toString('base64')}`);
    } catch {
      // unreachable/blocked/timeout: leave blocked
    }
  }
  return out;
}
