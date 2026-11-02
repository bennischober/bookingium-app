# Map preview (experimental) — findings and implementation plan

Working notes for issue #102 on `feat/map-preview-102`, written before any implementation.
It collects what the issue and its comment ask for and what the codebase already offers, so
implementation can start from step 1 of the plan below.

## What the prototype shows (issue body)

- A map with markers for **events (deal memos)** and **clubs/festivals**, coloured per kind
  (club / festival); filters for kind, band and date range.
- **Picking a club or festival centres the map** on it.
- A **radius ring around each event**: festivals ~300 km, clubs ~100 km. Reading of the
  feedback: this is the radius clause (Gebietsschutz), the area where the band may not play
  around that date. To confirm; if so, the preview uses these two defaults (editable in
  Einstellungen), and a per-contract radius can come later.
- Agency bookings (#103) should appear on the map too, in their own style (out of scope for
  the first prototype).

## Rules for the preview branch (issue comment, 2026-10-29)

- **No migration on the preview branch.** Coordinates are looked up at runtime, in memory,
  from a bundled postcode table — fast enough for a few hundred addresses. The
  `latitude`/`longitude` columns on `address` come with the real implementation (1.1.0).
- **Why:** a branch-only migration is dangerous for real data. If a preview build opens the
  real data folder, it records a migration `main` does not know; `main` then refuses the
  database (`NEWER_DATABASE_MESSAGE` in `src/main/db/migrate.ts`). And once `main` has newer
  migrations, drizzle applies only migrations dated after the last recorded one, so main
  migrations created earlier but merged later are silently skipped.
- If a migration turns out to be unavoidable, run the preview only against a **copy** of the
  data folder (`BOOKINGIUM_E2E_USER_DATA`), never the real one.
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
2. **Postcode data** `src/main/map/postcodes.ts` (generated JSON module): built once from
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
5. **Radius settings** (defaults 100/300 km) once the ring reading (radius clause, date
   span) is confirmed — put them next to the switch card.
6. **Tests**: pure helpers unit-tested (postcode lookup, marker building from rows,
   date-range filter). No migration → nothing for `tests/migration_upgrade.test.ts`; the
   existing suites must stay untouched and green. E2E is not meaningful for the preview
   (tiles need internet); no Playwright spec on this branch.
7. **Gates**: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`, then a manual
   `pnpm dev` run with the switch on — first against a copy of the real data folder
   (`BOOKINGIUM_E2E_USER_DATA`), per the branch rules above.

## Open questions (stay open, decided incrementally)

- Is the ring really the radius clause, and does it run around the event date only or a
  period (e.g. ± weeks)?
- Countries beyond DE/AT/CH — central Europe, or worldwide? GeoNames covers everything; the
  generator script makes this a data decision.
- Agency bookings (#103): own marker style, later.
