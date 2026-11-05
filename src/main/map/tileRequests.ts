// The map preview's tiles (#102) come from OpenStreetMap's volunteer-run tile
// servers, which answer with an "Access blocked" tile (403) to a request that
// neither comes from a web page (Referer) nor names its app (User-Agent). The
// packaged app loads from file://, so Chromium sends no Referer, and Electron's
// browser-like User-Agent is refused - only `pnpm dev` (localhost Referer) got
// tiles. The tile requests name the app instead, as the tile usage policy asks
// (https://operations.osmfoundation.org/policies/tiles/). Pure: index.ts
// registers it on the session.

/** The requests the User-Agent is rewritten for: the OSM tile host, nothing else */
export const TILE_REQUEST_URLS = ['https://tile.openstreetmap.org/*']

/** The User-Agent the tile requests carry: the app and where it comes from */
export function tileUserAgent(version: string): string {
  return `Bookingium/${version} (+https://github.com/bennischober/bookingium-app)`
}
