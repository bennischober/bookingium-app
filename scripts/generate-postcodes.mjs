// Generates src/main/map/postcodes.json from the GeoNames postal code dumps.
//
// The map preview (#102) locates addresses offline by postcode, without sending
// anything anywhere. This script builds the table once, by hand, and the result
// is committed: a build never downloads it (offline builds, the same data every
// time). The app itself never talks to a geocoding service. The file is plain
// data, marked generated in .gitattributes so diffs and PRs collapse it.
// Source and licence (CC BY 4.0) are named in postcodeLookup.ts and in the map's
// attribution line ("PLZ-Daten: GeoNames, CC BY 4.0") - JSON has no comments.
//
// Usage:
//   node scripts/generate-postcodes.mjs <folder-with-GeoNames-zip-txt> [--countries=DE,AT,CH] [--out=<file>]
//
// The dumps live at https://download.geonames.org/export/zip/<CC>.zip (CC BY 4.0).
// Download and unzip them first; each <CC>.txt is tab-separated UTF-8 with the fields
//   country, postal code, place name, admin name1, admin code1, admin name2,
//   admin code2, admin name3, admin code3, latitude, longitude, accuracy
// Rows without usable coordinates are skipped; a postcode that appears several
// times (one row per street or company) gets the average of its coordinates.
// Coordinates are the average per postcode, rounded to 4 decimals (~10 m) -
// postcode precision is plenty for a 100-300 km ring. The file is regenerated
// whole on every run - never edit it by hand.

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

const DEFAULT_COUNTRIES = ['DE', 'AT', 'CH']
const args = process.argv.slice(2)
const outArg = args.find((arg) => arg.startsWith('--out='))
const OUTPUT = resolve(outArg ? outArg.slice('--out='.length) : 'src/main/map/postcodes.json')
const folder = args.find((arg) => !arg.startsWith('--'))
const countriesArg = args.find((arg) => arg.startsWith('--countries'))
const countries = countriesArg
  ? countriesArg
      .split('=')[1]
      .split(',')
      .map((code) => code.trim().toUpperCase())
  : DEFAULT_COUNTRIES

if (!folder) {
  console.error('Usage: node scripts/generate-postcodes.mjs <folder-with-GeoNames-zip-txt>')
  process.exit(1)
}

/** `country postal` -> { latSum, lngSum, count } */
const postcodes = new Map()
let rows = 0
let skipped = 0

for (const country of countries) {
  const file = join(folder, `${country}.txt`)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    const fields = line.split('\t')
    const postal = fields[1]?.trim()
    const lat = Number.parseFloat(fields[9])
    const lng = Number.parseFloat(fields[10])
    if (!postal || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped++
      continue
    }
    rows++
    // The key is how the lookup reads addresses: country code + postcode
    const key = `${country}${postal}`
    const entry = postcodes.get(key) ?? { latSum: 0, lngSum: 0, count: 0 }
    entry.latSum += lat
    entry.lngSum += lng
    entry.count++
    postcodes.set(key, entry)
  }
}

const round = (value) => Math.round(value * 10000) / 10000
const entries = [...postcodes.entries()].sort(([a], [b]) => a.localeCompare(b))

// `{ "DE10115": [lat, lng] }`, one postcode per line - the layout prettier gives it
const body = entries
  .map(
    ([key, { latSum, lngSum, count }]) =>
      `  ${JSON.stringify(key)}: [${round(latSum / count)}, ${round(lngSum / count)}]`
  )
  .join(',\n')

const content = `{\n${body}\n}\n`

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, content, 'utf8')

console.log(
  `Wrote ${OUTPUT} (${entries.length} postcodes from ${rows} rows, ${skipped} skipped, countries ${countries.join(', ')})`
)
