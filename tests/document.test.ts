// Documents for any record: readable owner folders, uploads, the one-time
// move from the old storage/events/<id>/ layout, and clean-up on delete.
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { DocumentService } from '../src/main/services/DocumentService'
import { BandService } from '../src/main/services/BandService'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import { slugify } from '../src/main/utils/documentStorage'

import { setupTestDb } from './helpers/setup'

setupTestDb()

let storage: string
let sources: string

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'bookingum-documents-'))
  storage = join(root, 'storage')
  sources = join(root, 'sources')
  mkdirSync(sources)
  setStorageBasePath(storage)
})

afterAll(() => {
  setStorageBasePath(null)
  rmSync(join(storage, '..'), { recursive: true, force: true })
})

function sourceFile(name: string, content = 'pdf'): string {
  const path = join(sources, name)
  writeFileSync(path, content)
  return path
}

function createBand(name: string): number {
  const company = db
    .insert(schema.company)
    .values({ name: `${name} GbR` })
    .returning()
    .get()
  return db.insert(schema.band).values({ name, company_id: company.id }).returning().get().id
}

const posix = (path: string) => path.replace(/\\/g, '/')

describe('folder names', () => {
  it('are readable and safe', () => {
    expect(slugify('Pretty Wild – München!')).toBe('pretty-wild-muenchen')
    expect(slugify('2026-06-11 The New Roses / Café')).toBe('2026-06-11-the-new-roses-cafe')
    expect(slugify('???')).toBe('')
  })
})

describe('documents of a band', () => {
  const service = () => container.resolve(DocumentService)

  it('stores uploads in the band folder and keeps it when the band is renamed', async () => {
    const bandId = createBand('Pretty Wild')
    const rider = await service().upload({
      ownerType: 'band',
      ownerId: bandId,
      sourcePath: sourceFile('rider.pdf'),
      documentType: 'rider'
    })
    expect(posix(rider.file_path)).toBe(`documents/bands/${bandId}-pretty-wild/rider.pdf`)
    expect(rider).toMatchObject({ owner_type: 'band', document_type: 'rider', file_size: 3 })
    expect(existsSync(join(storage, rider.file_path))).toBe(true)

    db.update(schema.band)
      .set({ name: 'Pretty Wild Waters' })
      .where(eq(schema.band.id, bandId))
      .run()
    const again = await service().upload({
      ownerType: 'band',
      ownerId: bandId,
      sourcePath: sourceFile('rider.pdf'),
      documentType: 'other'
    })
    expect(posix(again.file_path)).toBe(`documents/bands/${bandId}-pretty-wild/rider_1.pdf`)
    expect(await service().listByOwner('band', bandId)).toHaveLength(2)
  })

  it('refuses owners that do not exist', async () => {
    await expect(
      service().upload({
        ownerType: 'company',
        ownerId: 9999,
        sourcePath: sourceFile('x.pdf'),
        documentType: 'other'
      })
    ).rejects.toThrow('nicht gefunden')
  })

  it('lists the documents of the band’s events', async () => {
    const bandId = createBand('The New Roses')
    const event = db
      .insert(schema.deal_memo)
      .values({ name: 'München', date: '2026-06-11', band_id: bandId })
      .returning()
      .get()
    await service().upload({
      ownerType: 'event',
      ownerId: event.id,
      sourcePath: sourceFile('vertrag.pdf'),
      documentType: 'contract'
    })
    const related = await service().listEventDocumentsForBand(bandId)
    expect(related).toHaveLength(1)
    expect(related[0]).toMatchObject({ eventName: 'München', file_name: 'vertrag.pdf' })
    expect(posix(related[0].file_path)).toBe(
      `documents/events/${event.id}-2026-06-11-muenchen/vertrag.pdf`
    )
  })

  it('deletes rows and folder with the band', async () => {
    const bandId = createBand('Gone Band')
    const doc = await service().upload({
      ownerType: 'band',
      ownerId: bandId,
      sourcePath: sourceFile('presse.pdf'),
      documentType: 'press'
    })
    await container.resolve(BandService).deleteBand(bandId)
    expect(await service().listByOwner('band', bandId)).toHaveLength(0)
    expect(existsSync(join(storage, doc.file_path, '..'))).toBe(false)
  })
})

describe('moving files from the old layout', () => {
  it('moves event files into readable folders once', async () => {
    const service = container.resolve(DocumentService)
    const bandId = createBand('April Art')
    const event = db
      .insert(schema.deal_memo)
      .values({ name: 'Fulda Kreuz', date: '2022-04-30', band_id: bandId })
      .returning()
      .get()
    const oldFolder = join(storage, 'events', String(event.id))
    mkdirSync(oldFolder, { recursive: true })
    writeFileSync(join(oldFolder, 'infosheet.doc'), 'doc')
    const legacy = db
      .insert(schema.document)
      .values({
        owner_type: 'event',
        owner_id: event.id,
        file_name: 'infosheet.doc',
        file_type: 'application/msword',
        file_path: join('events', String(event.id), 'infosheet.doc'),
        file_size: 3
      })
      .returning()
      .get()
    // A record whose file is gone keeps its path
    const missing = db
      .insert(schema.document)
      .values({
        owner_type: 'event',
        owner_id: event.id,
        file_name: 'weg.pdf',
        file_type: 'application/pdf',
        file_path: join('events', String(event.id), 'weg.pdf'),
        file_size: 3
      })
      .returning()
      .get()

    expect(await service.relocateLegacyFiles()).toEqual({ moved: 1, missing: 1 })

    const moved = (await service.getById(legacy.id))!
    expect(posix(moved.file_path)).toBe(
      `documents/events/${event.id}-2022-04-30-fulda-kreuz/infosheet.doc`
    )
    expect(existsSync(join(storage, moved.file_path))).toBe(true)
    expect(existsSync(oldFolder)).toBe(false)
    expect((await service.getById(missing.id))!.file_path).toBe(missing.file_path)

    // Nothing left to move on the next start
    expect(await service.relocateLegacyFiles()).toEqual({ moved: 0, missing: 1 })
  })
})

describe('deleting a document', () => {
  const service = () => container.resolve(DocumentService)

  it('hands the file path to the caller and keeps the record until it is removed', async () => {
    const bandId = createBand('Trash Band')
    const doc = await service().upload({
      ownerType: 'band',
      ownerId: bandId,
      sourcePath: sourceFile('alt.pdf'),
      documentType: 'other'
    })

    // The router moves this path to the OS trash before the row goes; the service
    // must report it and must not delete anything on its own
    const found = await service().detachFileForTrash(doc.id)
    expect(found?.filePath).toBe(join(storage, doc.file_path))
    expect(existsSync(join(storage, doc.file_path))).toBe(true)
    expect(await service().getById(doc.id)).not.toBeNull()

    await service().deleteDocumentRecord(doc.id)
    expect(await service().getById(doc.id)).toBeNull()
  })

  it('reports no file for a record whose file is already gone', async () => {
    const bandId = createBand('Missing File Band')
    const doc = await service().upload({
      ownerType: 'band',
      ownerId: bandId,
      sourcePath: sourceFile('weg2.pdf'),
      documentType: 'other'
    })
    rmSync(join(storage, doc.file_path), { force: true })

    // A missing file is not an error: the record still goes, without a path to trash
    expect(await service().detachFileForTrash(doc.id)).toMatchObject({ filePath: null })
    await service().deleteDocumentRecord(doc.id)
    expect(await service().getById(doc.id)).toBeNull()
  })

  it('reports nothing for an id that does not exist', async () => {
    expect(await service().detachFileForTrash(999_999)).toBeNull()
  })
})

describe('C5: an attachment becomes a document', () => {
  const service = () => container.resolve(DocumentService)

  it('writes the bytes into the owner folder and records the mail origin', async () => {
    const bandId = createBand('Antwort Band')
    const bytes = new Uint8Array([37, 80, 68, 70]) // "%PDF"
    const saved = await service().saveFromMail({
      ownerType: 'band',
      ownerId: bandId,
      fileName: 'Angebot.pdf',
      documentType: 'contract',
      bytes,
      messageId: '<antwort@example.test>',
      mailAccountId: 'acc-1'
    })

    expect(posix(saved.file_path)).toBe(`documents/bands/${bandId}-antwort-band/Angebot.pdf`)
    expect(saved).toMatchObject({
      owner_type: 'band',
      document_type: 'contract',
      file_size: 4,
      source_message_id: '<antwort@example.test>',
      source_mail_account_id: 'acc-1'
    })
    expect(existsSync(join(storage, saved.file_path))).toBe(true)
  })

  it('leaves the origin empty for an upload', async () => {
    const bandId = createBand('Upload Band')
    const uploaded = await service().upload({
      ownerType: 'band',
      ownerId: bandId,
      sourcePath: sourceFile('rider.pdf'),
      documentType: 'rider'
    })
    expect(uploaded.source_message_id).toBeNull()
    expect(uploaded.source_mail_account_id).toBeNull()
  })

  it('refuses an owner that does not exist', async () => {
    await expect(
      service().saveFromMail({
        ownerType: 'band',
        ownerId: 999_999,
        fileName: 'x.pdf',
        bytes: new Uint8Array([1]),
        messageId: null,
        mailAccountId: 'acc-1'
      })
    ).rejects.toThrow(/nicht gefunden/)
  })
})
