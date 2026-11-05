# Map preview (experimental) — findings, decisions and implementation

Working notes for issue #102 on `feat/map-preview-102`. Started before any implementation;
the decisions taken since (radius clause, countries) are in their own section below.

## What the prototype shows (issue body)

- A map with markers for **events (deal memos)** and **clubs/festivals**, coloured per kind
  (club / festival); filters for kind, band and date range.
- **Picking a club or festival centres the map** on it.
- A **radius ring around each event**: festivals ~300 km, clubs ~100 km — the radius
  clause (Gebietsschutz), see „Radius clause“ below.
- Agency bookings (#103) should appear on the map too, in their own style (out of scope for
  the first prototype).

## Rules for the preview branch (issue comment, 2026-10-29)

- **Coordinates stay a runtime lookup**, in memory, from a bundled postcode table — fast
  enough for a few hundred addresses. No `latitude`/`longitude` columns.
- **One migration, since 2026-11-02:** `0020` adds the radius clause overrides (six nullable
  integer columns on `venue` and `deal_memo`). The original „no migration on the preview
  branch“ rule is lifted for it, with its reasons still in force:
  - a preview build that opens the real data folder records a migration `main` does not
    know, and `main` then refuses the database (`NEWER_DATABASE_MESSAGE` in
    `src/main/db/migrate.ts`) — run branch builds only against a **copy** of the data folder
    (`BOOKINGIUM_E2E_USER_DATA`), never the real one;
  - drizzle applies only migrations dated after the last recorded one: if `main` gains a
    migration before this branch merges, regenerate `0020` (delete it and its snapshot,
    merge, `pnpm db:generate`) so it comes last.
- The rest of the brief as written: experimental switch off by default (like the mail client
  and Verteiler); Leaflet (BSD-2); OSM attribution plus a CSP `img-src` entry for the tile
  host; GeoNames postcodes (CC BY 4.0) with an attribution line; **no address leaves the
  machine** (no geocoding API calls — the bundled table is the only lookup).
- **Tile requests name the app.** OSM's tile servers answer a request with neither a Referer
  nor an app User-Agent with an "Access blocked" tile. The packaged app loads from `file://`
  (no Referer), so `src/main/map/tileRequests.ts` sets a `Bookingium/<version>` User-Agent for
  `tile.openstreetmap.org` only; `pnpm dev` hides the problem (localhost Referer).

## What the codebase offers today

- `address` (`src/main/db/schema.ts`): `street`, `street_number`, `zip_code`, `city`,
  `state`, `country`, `country_code` (ISO 3166-1 alpha-2). No coordinates anywhere — the
  bundled postcode table is the bridge.
- `venue.kind` is `'venue' | 'festival'` (clubs are venues); venues link `address_id`.
- `deal_memo`: `date` (ISO `YYYY-MM-DD`), `status`, `venue_id`, `band_id`, `archived_at`
  (D3: archived events are out of every working view — exclude them here too).
- **The experimental-switch pattern to copy** is the Verteiler one: `contactLists: boolean`
  default false in `AppSettings` (`api/schemas/settings.schema.ts`, and keep the
  `UpdateAppSettingsInput` `.unwrap()` list in sync) → a `*SwitchCard` in Einstellungen ›
  Allgemein (`ContactListsSwitchCard.tsx`) → `useRouteShown()` hides the menu entry and the
  search hit while off → the route stays reachable and the page shows an off-note
  (`ContactListPage.tsx` top section).
- Read-only aggregate services query `db` directly on purpose (`DashboardService`,
  `SearchService`); a `MapService` fits that shape — no repository needed for the prototype.
- CSP lives in `src/renderer/index.html` (`img-src 'self' data:` today): add
  `https://tile.openstreetmap.org` (and the attribution line in the map footer).
- Routes register in `router.tsx` under the `_app` layout with a `ROUTES` entry in
  `lib/routing.ts` (order = menu order and Alt+n shortcuts). Icons: `MapPin` is taken by
  Clubs; `Map` or `Globe` is free.

## Implementation plan

1. **Setting** `mapPreview: boolean` default false (`AppSettings` + `UpdateAppSettingsInput`);
   `MapPreviewSwitchCard` next to `ContactListsSwitchCard`; `useRouteShown` entry for
   `/map`; `ROUTES.map = { path: '/map', title: 'Karte', group: 'Planung', icon: Map }`.
2. **Postcode data** `src/main/map/postcodes.json` (generated, committed data): built once from
   the GeoNames postal dumps (`download.geonames.org/export/dump/{DE,AT,CH}.zip`, format
   `country, postal, place, admin1, admin2, admin3, lat, lng, accuracy`), filtered to
   DE/AT/CH. The generator script lives in `scripts/` so more countries are one command away
   (the countries question below is then a data decision, not a code one). Attribution
   „PLZ-Daten: GeoNames, CC BY 4.0“ next to the OSM line.
3. **Lookup + service + router**: pure lookup in `src/main/map/` (keyed `country_code +
   zip_code`; ambiguous postcodes share coordinates — postcode precision is plenty for a
   100–300 km ring), a read-only `MapService`, and a `map.router.ts` registered in
   `api/router.ts`. One procedure `map.getData` with input
   `{ kinds?, bandId?, dateFrom?, dateTo? }` returning markers
   `{ type: 'event' | 'venue', id, kind, name, date?, bandIds?, located, addressLabel, lat, lng }`.
   `located: false` marks addresses without a known postcode; the page lists them as
   „nicht auf der Karte“, each with its reason (`no_venue`, `no_address`,
   `unknown_postcode`) and a link to where it is fixed. The country comes from
   `country_code`, else the country name (as the e-invoice check reads it), else a
   five-digit postcode counts as German; four-digit AT/CH codes without a country stay
   unlocated.
4. **Map page** `pages/MapPage.tsx` + `components/map/`: Leaflet directly (no react-leaflet
   for the prototype; `@types/leaflet` as a dev dependency), OSM tile layer with attribution,
   `L.circle` rings in metres (club 100 000, festival 300 000 — later two number settings),
   colour per kind, kind/band/date filters (from today by default), and a venue picker
   that `flyTo`s its marker. Markers are grouped per point (an event sits on its venue's
   postcode point): one dot pair, one ring per size, one popup listing everything there
   with links to the detail pages.
   Leaflet needs a fixed-height container and `invalidateSize()` on resize; its CSS is
   imported by the page.
5. **Radius clause** (see below): defaults in the switch card, overrides on the venue form
   and the event's overview tab, rings, blocking and the what-if in `buildMapData`.
6. **Tests**: pure helpers unit-tested (postcode lookup, marker building from rows,
   date-range filter, clause resolution, blocking, what-if, the display and form helpers in
   `components/map/*Display.ts`). The `0020` columns are plain nullable additions, so
   `tests/migration_upgrade.test.ts` needs nothing. E2E is not meaningful for the preview
   (tiles need internet); no Playwright spec on this branch.
7. **Gates**: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`, then a manual
   `pnpm dev` run with the switch on — first against a copy of the real data folder
   (`BOOKINGIUM_E2E_USER_DATA`), per the branch rules above.

## Radius clause (decided 2026-11-02, see #102)

The ring is the radius clause: the band may not play within `km` of the show from
`weeksBefore` weeks before to `weeksAfter` weeks after its date. Two uses, one calculation
(`src/main/map/markers.ts`):

- **Room for the band:** with a band chosen, every club and festival is free, at risk or
  blocked — blocked when it lies inside the ring of one of the band's confirmed events, at
  risk inside the ring of an open offer (`pending`). Cancelled and archived events never
  block. The popup names the events that block it.
- **What-if:** a candidate venue and date („Anfrage prüfen“) get a dashed orange ring,
  the list of clubs and festivals it would block, and the band's events it collides with,
  either way round (the candidate's ring covers the event, the event's ring covers the
  candidate, both, or the event has no location but overlaps in time).

**Layers, each field on its own:** the deal memo's own value, else the venue's, else the
default for the venue kind in Einstellungen › Allgemein (clubs 100 km ± 4 weeks, festivals
300 km ± 8 weeks). No booking-company level. Resolution is `effectiveClause` in
`src/main/map/radius.ts`; the forms show the inherited value as placeholder.

**Display:** confirmed rings solid, open offers dashed (a solid ring of the same size wins),
blocked venues grey, venues at risk with an amber outline. The date filter keeps an event
while its clause window overlaps the range, not only its show date.
The kind filter only changes what the map shows: a festival's ring still blocks the clubs
inside it while only clubs are shown. An event whose date is not `YYYY-MM-DD` gets no
window and is listed as „nicht auf der Karte“ (Datum ungültig).

## Decided

- Countries: DACH now; others on demand, one generator run each (`scripts/`).

## Open

- Agency bookings (#103): own marker style, later.
