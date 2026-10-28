// D2: documents in the search palette.
//
// They were the one business object the palette could not find at all: SearchService covered
// every record type and zero document queries, so a file could only be reached by remembering
// which record it hangs off.
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { SearchService } from '../src/main/services/SearchService'
import { DocumentService } from '../src/main/services/DocumentService'
import { setStorageBasePath } from '../src/main/utils/fileStorage'

import { setupTestDb } from './helpers/setup'

setupTestDb()

let root: string
let sources: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bookingum-search-documents-'))
  sources = join(root, 'sources')
  mkdirSync(sources)
  setStorageBasePath(join(root, 'storage'))
})

afterAll(() => {
  setStorageBasePath(null)
  rmSync(root, { recursive: true, force: true })
})

function sourceFile(name: string): string {
  const path = join(sources, name)
  writeFileSync(path, 'pdf')
  return path
}

/** A band with one uploaded document, returned as the band's name and the upload */
async function bandWithDocument(
  bandName: string,
  fileName: string,
  documentType = 'rider'
): Promise<{ bandId: number }> {
  const company = db
    .insert(schema.company)
    .values({ name: `${bandName} GbR` })
    .returning()
    .get()
  const band = db
    .insert(schema.band)
    .values({ name: bandName, company_id: company.id })
    .returning()
    .get()
  await container.resolve(DocumentService).upload({
    ownerType: 'band',
    ownerId: band.id,
    sourcePath: sourceFile(fileName),
    documentType
  })
  return { bandId: band.id }
}

describe('D2: a document is found by its file name', () => {
  const service = () => container.resolve(SearchService)

  it('finds a document and names its owner and category', async () => {
    await bandWithDocument('Findbare Band', 'Tourbook 2026.pdf', 'rider')

    const { results } = await service().search('Tourbook')
    const document = results.find((r) => r.type === 'document')

    expect(document).toBeDefined()
    expect(document?.label).toBe('Tourbook 2026.pdf')
    // The category and the record it belongs to, so the user knows which one it is
    expect(document?.sublabel).toBe('Rider · Findbare Band')
    // A file opens directly; navigating to its record would make the user search again
    expect(document?.filePath).toBeTruthy()
    expect(document?.route).toBe('')
  })

  it('is found by a part of the name, not only the whole one', async () => {
    await bandWithDocument('Teilstring Band', 'Stageplot Halle 3.pdf', 'stage_plot')

    const { results } = await service().search('Halle')
    expect(results.find((r) => r.type === 'document')?.label).toBe('Stageplot Halle 3.pdf')
  })

  it('treats an underscore in a file name as text, not as a wildcard', async () => {
    // `_` matches any single character in LIKE. Without escaping, "rider_final" would also
    // match "riderXfinal" - and an underscore is common in file names.
    await bandWithDocument('Unterstrich Band', 'rider_final.pdf')
    await bandWithDocument('Wildcard Band', 'riderXfinal.pdf')

    const { results } = await service().search('rider_final')
    const documents = results.filter((r) => r.type === 'document')

    expect(documents.map((d) => d.label)).toEqual(['rider_final.pdf'])
  })

  it('treats a percent sign in a file name as text, not as a wildcard', async () => {
    await bandWithDocument('Prozent Band', 'Rabatt 10%.pdf')
    // A decoy that an unescaped `%` would also match: `%10%%` matches this too
    await bandWithDocument('Dezimal Band', 'Rabatt 10x.pdf')

    const { results } = await service().search('10%')
    const documents = results.filter((r) => r.type === 'document')

    expect(documents.map((d) => d.label)).toEqual(['Rabatt 10%.pdf'])
  })

  it('still finds the records themselves, not only their files', async () => {
    await bandWithDocument('Beides Band', 'Beides Rider.pdf')

    const { results } = await service().search('Beides')
    const types = results.map((r) => r.type)
    expect(types).toContain('band')
    expect(types).toContain('document')
  })

  it('carries no absolute path for a record, and a relative one for a document', async () => {
    await bandWithDocument('Pfad Band', 'Pfad Rider.pdf')

    const { results } = await service().search('Pfad')
    const band = results.find((r) => r.type === 'band')
    const document = results.find((r) => r.type === 'document')

    expect(band?.filePath).toBeNull()
    // Relative to the storage folder, exactly as the document rows keep it - with the
    // separator of the OS that saved it
    expect(document?.filePath).not.toMatch(/^([a-zA-Z]:|\/)/)
    expect(document?.filePath).toMatch(/^documents[\\/]/)
  })
})
