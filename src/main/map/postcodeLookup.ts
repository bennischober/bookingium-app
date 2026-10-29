// The experimental map preview (#102) locates addresses offline: by postcode,
// from the bundled GeoNames table (see scripts/generate-postcodes.mjs). Nothing
// is sent anywhere - the lookup is the only geocoding the app does.

import { POSTCODES } from './postcodes'

/** Coordinates resolved from a postcode, in degrees (WGS84) */
export type Coordinates = { lat: number; lng: number }

/**
 * Resolves coordinates for an address from its postcode. Postcode precision is
 * plenty for a 100-300 km ring, and ambiguous postcodes (one code, several
 * rows in the dump) share the bundled average anyway - so the first hit is the
 * answer.
 *
 * The country code is ISO 3166-1 alpha-2 ('DE', '' for unknown).
 */
export function lookupPostcode(countryCode: string, zipCode: string): Coordinates | null {
  const zip = zipCode.trim()
  const country = countryCode.trim().toUpperCase()
  if (!zip || country.length !== 2) return null
  const hit = POSTCODES[`${country}${zip}`]
  return hit ? { lat: hit[0], lng: hit[1] } : null
}
