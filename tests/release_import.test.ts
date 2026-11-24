// #289: label copies read from an Excel template and an OpenPlay PDF report, the preview
// against a release and the merge. All names and codes are made up.
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { setupTestDb } from './helpers/setup'
import { buildXlsxSheets, type Cell } from './helpers/xlsx'
import { readXlsxSheets, excelSerialToTime } from '../src/main/import/xlsx'
import { parseExcelLabelCopy } from '../src/main/release/import/excelTemplate'
import { parseOpenPlayLabelCopy } from '../src/main/release/import/openplayPdf'
import {
  parseLooseDate,
  parseTrackDuration,
  splitNames,
  workRoles
} from '../src/main/release/import/values'
import { mergeHead, mergeTrack, planLabelCopy } from '../src/main/release/import/plan'
import { ReleaseImportService } from '../src/main/services/ReleaseImportService'
import { ReleaseService } from '../src/main/services/ReleaseService'
import { BandService } from '../src/main/services/BandService'
import { CompanyService } from '../src/main/services/CompanyService'
import { MarketingActionService } from '../src/main/services/MarketingActionService'
import { DocumentService } from '../src/main/services/DocumentService'
import { CreateCompanyInput } from '../src/main/api/schemas/company.schema'
import { ReleaseMapper } from '../src/main/api/mappers/release.mapper'
import { ApplyLabelCopyInput } from '../src/main/api/schemas/release_import.schema'
import { setStorageBasePath } from '../src/main/utils/fileStorage'

setupTestDb()

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bookingum-labelcopy-'))
  setStorageBasePath(join(dir, 'storage'))
})
afterAll(() => {
  setStorageBasePath(null)
  rmSync(dir, { recursive: true, force: true })
})

// ---------- fixtures ----------

/** Track durations as Excel keeps "2:47" typed into an hh:mm cell: 2 hours 47 minutes */
const asHoursMinutes = (minutes: number, seconds: number) => (minutes * 60 + seconds) / 1440

function templateWorkbook(budget: Cell[][] = []): Buffer {
  const trackHeader = [
    'No.',
    'Track Title',
    'Track Version / Featuring',
    'Track Composer',
    'Track Lyricist/Texter',
    'Duration',
    'Track ISRC',
    'Publisher'
  ]
  const tracks: Cell[][] = [
    [
      '1',
      'Erster Song',
      '',
      'Erika Muster, Max Beispiel, ',
      'Erika Muster',
      { time: asHoursMinutes(2, 47) },
      'XX0AA2600001',
      'Beispiel Verlag'
    ],
    [
      '2',
      'Zweiter Song',
      'Radio Edit',
      'Max Beispiel',
      'Erika Muster',
      0.113194444,
      'XX0AA2600002',
      ''
    ]
  ]
  return buildXlsxSheets([
    {
      name: 'GENERAL INFO',
      rows: [
        ['GENERAL INFO'],
        [],
        ['ARTIST', 'Probeband'],
        ['TITLE', 'Probealbum'],
        ['CATALOGUE NO', 'PROBE100'],
        ['RELEASE DATE', { date: 46297 }],
        ['LABEL', 'Beispiel Records'],
        ['C + P ', '℗ & © 2026'],
        ['MAIN GENRE', 'Rock'],
        ['PRODUCED By / At', 'Erika Muster, Studio Probe'],
        ['MIXED By / At', 'Max Beispiel'],
        [],
        ['BAND MEMBERS', 'Name', 'Instrument(s)'],
        ['1', 'Erika Muster', 'Gesang'],
        ['2', 'Max Beispiel', 'Schlagzeug'],
        [],
        ['GUESTS', 'Name', 'Instrument(s)', 'Track'],
        ['', 'Gast Beispiel', 'Cello', '2'],
        [],
        ['COMPOSER / TEXTER', 'Name', 'Copyright Society', 'IPI Number'],
        ['Texter', 'Erika Muster', 'GEMA', '00123456789'],
        ['Composer', '', '….', '….']
      ]
    },
    {
      name: 'Digipak',
      rows: [
        ['Digipak'],
        ['PRODUCT TYPE', 'Physical'],
        ['DISCS', '1'],
        ['UPC', '4006381333931'],
        ['CAT. NO.', 'PROBE100DP'],
        ['TERRITORY', 'World '],
        ['BOX LOT', '25'],
        [],
        ['CD 1'],
        trackHeader,
        ...tracks,
        [],
        ['', '', '', '', 'Total', { time: 0.3 }],
        ['EAN Jewelcase', '036000291452']
      ]
    },
    {
      name: 'Digital',
      rows: [
        ['DIGITAL'],
        ['PRODUCT TYPE', 'Digital Album'],
        ['UPC', ''],
        ['CAT. NO.', 'PROBE100D'],
        [],
        [...trackHeader, 'Explicit'],
        [...tracks[0], 'no'],
        [...tracks[1], 'yes'],
        [],
        ['SINGLES / IGTs'],
        ['UPC', 'Cat. No.', 'Track Title', 'Release Date', 'Focus Track', '', 'Video ISRC'],
        ['012345678905', 'PROBE100DS1', 'zweiter song', { date: 46200 }, '', '', 'XX0AA2600099'],
        ['', '', 'Erster Song', { date: 46239 }, '', '', 'XX0AA2600098']
      ]
    },
    {
      name: 'Vinyl',
      rows: [
        ['VINYL'],
        ['PACKAGING', 'Gatefold'],
        ['UPC', '9780201379624'],
        ['CAT. NO.', 'PROBE100V1'],
        [],
        [...trackHeader, 'Side A/B'],
        ['1', 'Erster Song', '', '', '', '', 'XX0AA2600001', '', 'A'],
        ['2', 'Zweiter Song', '', '', '', '', 'XX0AA2600002', '', 'B'],
        [],
        ['OTHER COLOURS', 'Cat No.', 'Artist', 'Title', 'Configuration', 'Units'],
        ['9781234567897', 'PROBE100V2', '', 'Rot', '', ''],
        ['', '', '', '', '', '']
      ]
    },
    { name: 'Budget', rows: budget }
  ])
}

/** A report as pdf.js extracts it: cells separated by runs of spaces, footers in between */
const REPORT = [
  'Primary Release Date: ',
  '04/16/2027 ',
  'Reissue Date: ',
  '- ',
  'Last Modified: ',
  '03/01/2027 10:00:00 AM',
  'by Erika Muster ',
  'Probesingle ',
  'Duration:   6:42 ',
  'Main Artist:   Probeband ',
  'Version:   - ',
  'Release Number:   PROBE200DS ',
  'UPC:   4006381333931 ',
  'P Line:   2027 Beispiel Records ',
  'C Line:   2027 Beispiel Records ',
  'Label:   Beispiel Records ',
  'Genre:   Rock ',
  'Configuration:   Digital Single ',
  'Territory:   World ',
  'Project #:   PR001 ',
  'Disc 1',
  'Probesingle ',
  'Track 1   3:22 ',
  'Version:   - ',
  'ISRC:   XX0AA2700001 ',
  'Genre:   Rock ',
  'Contributors:   Artist   Role ',
  'Probeband   Primary ',
  'Gast Beispiel   Featuring ',
  'Flags:   Explicit ',
  'P Line:   2027 Beispiel Records ',
  'Notes:   -',
  'Work: Probesingle',
  'Probesingle (Probeband) | Page 1 of 2 Label Copy   Report Date:   03/01/2027 10:00:00 AM ',
  'Reported By:   Erika Muster ',
  'Contributions:   Artist Name   Role   Affiliation   Split Percentage   Country ',
  'Erika Muster   Writer   GEMA   100.0%   Germany',
  'Erika Muster   Composer   GEMA   50.0%   Germany',
  'Max Beispiel   Composer   50.0%   Austria ',
  'B-Seite ',
  'Track 2   3:20 ',
  'ISRC:   XX0AA2700002 ',
  'Contributors:   Artist   Role ',
  'Probeband   Primary ',
  'Work: B-Seite ',
  'Contributions:   Artist Name   Role   Affiliation   Split Percentage   Country ',
  'Max Beispiel   Composer/Lyricist   100%   Austria',
  'Probesingle (Probeband) | Page 2 of 2 Label Copy   Report Date:   03/01/2027 10:00:00 AM '
].join('\n')

// ---------- values ----------

describe('values', () => {
  it('reads dates, durations, names and roles', () => {
    expect(parseLooseDate('02.10.2026')).toBe('2026-10-02')
    expect(parseLooseDate('07/26/2024')).toBe('2024-07-26')
    expect(parseLooseDate('46297')).toBe('2026-10-02')
    expect(parseLooseDate('-')).toBeNull()
    expect(parseTrackDuration('3:22')).toEqual({ seconds: 202, shifted: false })
    // "2:47" stored as hours:minutes
    expect(parseTrackDuration('0,115972222')).toEqual({ seconds: 167, shifted: true })
    expect(parseTrackDuration('2:47:00')).toEqual({ seconds: 167, shifted: true })
    expect(parseTrackDuration('0:02:47')).toEqual({ seconds: 167, shifted: false })
    expect(splitNames('A, B; C & D, ')).toEqual(['A', 'B', 'C', 'D'])
    expect(workRoles('Writer')).toEqual(['lyricist'])
    expect(workRoles('Composer/Lyricist')).toEqual(['lyricist', 'composer'])
  })

  it('reads time cells of a workbook as times, not as 1899 dates', () => {
    expect(excelSerialToTime(asHoursMinutes(2, 47))).toBe('2:47')
    expect(excelSerialToTime(1.5)).toBe('36:00')
    const [sheet] = readXlsxSheets(buildXlsxSheets([{ name: 'T', rows: [[{ time: 0.5 }]] }]))
    expect(sheet.records[0][0]).toBe('12:00')
  })
})

// ---------- Excel template ----------

describe('Excel label copy', () => {
  const parse = (budget: Cell[][] = []) =>
    parseExcelLabelCopy(readXlsxSheets(templateWorkbook(budget)))!

  it('reads the head, credits and line-up', () => {
    const copy = parse()
    expect(copy.source).toBe('excel')
    expect(copy.head).toMatchObject({
      artistName: 'Probeband',
      title: 'Probealbum',
      catalogNumber: 'PROBE100',
      releaseDate: '2026-10-02',
      label: 'Beispiel Records',
      pLine: '℗ 2026 Beispiel Records',
      cLine: '© 2026 Beispiel Records',
      releaseType: 'album'
    })
    expect(copy.credits.map((c) => `${c.name}/${c.role}/${c.instrument}`)).toEqual([
      'Erika Muster/Producer/',
      'Studio Probe/Producer/',
      'Max Beispiel/Mixing Engineer/',
      'Erika Muster/Band Member/Gesang',
      'Max Beispiel/Band Member/Schlagzeug'
    ])
  })

  it('collects the tracks of all products once, with writers and guests', () => {
    const copy = parse()
    expect(copy.tracks.map((t) => [t.title, t.durationSeconds, t.isrc])).toEqual([
      ['Erster Song', 167, 'XX0AA2600001'],
      ['Zweiter Song', 163, 'XX0AA2600002']
    ])
    expect(copy.warnings[0]).toContain('Minuten:Sekunden')
    const [first, second] = copy.tracks
    expect(first.workShares.map((s) => [s.name, s.role, s.society, s.ipi, s.publisher])).toEqual([
      ['Erika Muster', 'lyricist', 'GEMA', '00123456789', 'Beispiel Verlag'],
      ['Erika Muster', 'composer', 'GEMA', '00123456789', 'Beispiel Verlag'],
      ['Max Beispiel', 'composer', '', '', 'Beispiel Verlag']
    ])
    expect(second.explicit).toBe(true)
    expect(second.version).toBe('Radio Edit')
    expect(second.videoIsrc).toBe('XX0AA2600099')
    expect(second.contributors.map((c) => c.role)).toEqual(['Primary Artist', 'Guest Musician'])
    expect(first.contributors.map((c) => c.role)).toEqual(['Primary Artist'])
  })

  it('reads every product: sheets, the jewel case, the single, the colour variant', () => {
    const products = parse().products
    expect(
      products.map((p) => [p.format, p.title, p.packaging, p.color, p.upc, p.catalogNumber])
    ).toEqual([
      ['cd', '', 'Digipak', '', '4006381333931', 'PROBE100DP'],
      ['cd', '', 'Jewelcase', '', '036000291452', ''],
      ['digital', '', '', '', '', 'PROBE100D'],
      ['digital', 'Single „zweiter song“', '', '', '012345678905', 'PROBE100DS1'],
      ['vinyl', '', 'Gatefold', '', '9780201379624', 'PROBE100V1'],
      ['vinyl', '', 'Gatefold', 'Rot', '9781234567897', 'PROBE100V2']
    ])
    expect(products[0].boxLot).toBe(25)
    expect(products[1].boxLot).toBeNull()
    expect(products[3].releaseDate).toBe('2026-06-27')
    expect(products[3].tracks.map((t) => t.trackKey)).toEqual(['isrc:XX0AA2600002'])
    expect(products[4].tracks.map((t) => t.side)).toEqual(['A', 'B'])
    expect(products[5].tracks).toHaveLength(2)
  })

  it('takes budget lines with an amount or marked done, not the template rows', () => {
    const copy = parse([
      ['BUDGET'],
      [],
      ['PRINT', '', '', '', '', 'DIGITAL', '', '', '', '', '', 'PR / SALES'],
      [
        'Magazine + Country',
        'Size',
        'Projected',
        'Done?',
        '',
        'Single',
        'Platform',
        'Timeframe',
        'Projected',
        'Done?',
        '',
        'Action',
        'Projected',
        'Done?'
      ],
      [
        'Probe Magazin (D)',
        '1/1',
        '1.200 €',
        'x',
        '',
        'Erster Song',
        'Youtube',
        '2 Wochen',
        '500',
        '',
        '',
        'Listening Session',
        '',
        ''
      ],
      ['Leeres Magazin (F)', '', '', '', '', '', 'IG', '', '', '', '', 'PR Probe', '300,50', ''],
      ['Full amount', '', '0']
    ])
    expect(copy.budget.map((b) => [b.section, b.kind, b.title, b.costCents, b.done])).toEqual([
      ['print', 'print_ad', 'Anzeige Probe Magazin (D)', 120000, true],
      ['digital', 'online_ad', 'Youtube „Erster Song“', 50000, false],
      ['pr', 'other', 'PR Probe', 30050, false]
    ])
  })

  it('is not taken for any other workbook', () => {
    expect(
      parseExcelLabelCopy(
        readXlsxSheets(buildXlsxSheets([{ name: 'Tour', rows: [['Datum', 'Ort']] }]))
      )
    ).toBeNull()
  })
})

// ---------- OpenPlay report ----------

describe('OpenPlay label copy', () => {
  it('reads release, tracks, performers and splits through the page footers', () => {
    const copy = parseOpenPlayLabelCopy(REPORT)!
    expect(copy.head).toMatchObject({
      title: 'Probesingle',
      artistName: 'Probeband',
      catalogNumber: 'PROBE200DS',
      releaseDate: '2027-04-16',
      releaseType: 'single',
      projectNumber: 'PR001',
      pLine: '2027 Beispiel Records'
    })
    expect(copy.products).toHaveLength(1)
    expect(copy.products[0]).toMatchObject({
      format: 'digital',
      upc: '4006381333931',
      territory: 'World'
    })
    expect(copy.tracks.map((t) => [t.title, t.durationSeconds, t.isrc, t.explicit])).toEqual([
      ['Probesingle', 202, 'XX0AA2700001', true],
      ['B-Seite', 200, 'XX0AA2700002', null]
    ])
    const [first, second] = copy.tracks
    // the same genre and P line as the release are not repeated on the track
    expect(first.genre).toBe('')
    expect(first.pLine).toBe('')
    expect(first.contributors.map((c) => `${c.name}/${c.role}`)).toEqual([
      'Probeband/Primary Artist',
      'Gast Beispiel/Featured Artist'
    ])
    expect(
      first.workShares.map((s) => [s.name, s.role, s.sharePercent, s.society, s.country])
    ).toEqual([
      ['Erika Muster', 'lyricist', 100, 'GEMA', 'Germany'],
      ['Erika Muster', 'composer', 50, 'GEMA', 'Germany'],
      ['Max Beispiel', 'composer', 50, '', 'Austria']
    ])
    expect(second.workShares.map((s) => [s.role, s.sharePercent])).toEqual([
      ['lyricist', 100],
      ['composer', 100]
    ])
  })

  it('is not taken for other PDFs', () => {
    expect(parseOpenPlayLabelCopy('Rechnung Nr. 1\nBetrag: 100 €')).toBeNull()
  })
})

// ---------- preview and merge ----------

describe('preview and merge', () => {
  it('fills empty fields and only replaces differing ones when asked', async () => {
    const copy = parseOpenPlayLabelCopy(REPORT)!
    const service = container.resolve(ReleaseService)
    const created = ReleaseMapper.toDetailDto(
      await service.create({
        bandId: null,
        artistName: '',
        title: 'Probesingle',
        version: '',
        releaseType: 'single',
        releaseDate: null,
        originalReleaseDate: null,
        preorderD2cDate: null,
        preorderRetailDate: null,
        preorderDigitalDate: null,
        label: 'Anderes Label',
        catalogNumber: '',
        pLine: '',
        cLine: '',
        genre: '',
        subGenre: '',
        metadataLanguage: '',
        recordingCountry: '',
        projectNumber: '',
        notes: 'bleibt'
      })
    )
    const plan = planLabelCopy(copy, created)
    const label = plan.head.find((h) => h.field === 'label')!
    expect(label).toMatchObject({ status: 'conflict', current: 'Anderes Label' })
    expect(plan.head.find((h) => h.field === 'catalogNumber')!.status).toBe('fill')
    expect(plan.head.find((h) => h.field === 'title')!.status).toBe('same')
    expect(plan.tracks.every((t) => t.status === 'new')).toBe(true)

    expect(mergeHead(created, copy.head, [], null).label).toBe('Anderes Label')
    expect(mergeHead(created, copy.head, ['label'], null).label).toBe('Beispiel Records')
    expect(mergeHead(created, copy.head, [], null).notes).toBe('bleibt')
  })

  it('keeps a track’s own writers unless overwriting, but fills their society', () => {
    const copy = parseOpenPlayLabelCopy(REPORT)!
    const incoming = copy.tracks[0]
    const current = {
      id: 5,
      releaseId: 1,
      position: 1,
      title: 'Probesingle',
      version: '',
      durationSeconds: 200,
      isrc: '',
      explicit: false,
      genre: '',
      pLine: '',
      cLine: '',
      videoIsrc: '',
      lyrics: '',
      notes: '',
      contributors: [],
      workShares: [
        {
          id: 1,
          name: 'Erika Muster',
          role: 'lyricist' as const,
          sharePercent: 100,
          society: '',
          ipi: '',
          publisher: '',
          country: '',
          personId: null
        }
      ]
    }
    const kept = mergeTrack(1, current, incoming, false)
    expect(kept.durationSeconds).toBe(200)
    expect(kept.isrc).toBe('XX0AA2700001')
    expect(kept.workShares).toHaveLength(1)
    expect(kept.workShares[0].society).toBe('GEMA')
    expect(kept.contributors).toHaveLength(2)
    const replaced = mergeTrack(1, current, incoming, true)
    expect(replaced.durationSeconds).toBe(202)
    expect(replaced.workShares).toHaveLength(3)
  })
})

// ---------- the whole import ----------

describe('import service', () => {
  it('creates a release from the Excel copy, then completes it with the report', async () => {
    const owner = await container
      .resolve(CompanyService)
      .createCompany(CreateCompanyInput.parse({ name: 'Probe Management GmbH' }))
    await container
      .resolve(CompanyService)
      .createCompany(CreateCompanyInput.parse({ name: 'Beispiel Records' }))
    const band = await container
      .resolve(BandService)
      .createBand({ name: 'Probeband', companyId: owner.id, genre: '', notes: '' })
    const service = container.resolve(ReleaseImportService)

    const xlsxPath = join(dir, 'Probealbum LC.xlsx')
    writeFileSync(
      xlsxPath,
      templateWorkbook([
        ['Magazine + Country', 'Size', 'Projected', 'Done?'],
        ['Probe Magazin (D)', '1/1', '800', '']
      ])
    )
    const file = (path: string, name: string) => ({
      bytes: new Uint8Array(readFileSync(path)),
      fileName: name,
      path
    })

    const plan = await service.plan(file(xlsxPath, 'Probealbum LC.xlsx'))
    expect(plan.releaseId).toBeNull()
    expect(plan.suggestedBandId).toBe(band.id)
    expect(plan.tracks).toHaveLength(2)
    expect(plan.products).toHaveLength(6)
    expect(plan.budget).toHaveLength(1)

    const result = await service.apply(file(xlsxPath, 'Probealbum LC.xlsx'), {
      path: xlsxPath,
      releaseId: null,
      bandId: band.id,
      takeFields: [],
      overwrite: false,
      budget: [0]
    })
    expect(result).toMatchObject({
      created: true,
      tracksAdded: 2,
      productsAdded: 6,
      measuresAdded: 1,
      documentStored: true
    })
    const release = ReleaseMapper.toDetailDto(
      (await container.resolve(ReleaseService).getDetail(result.releaseId))!
    )
    expect(release.bandId).toBe(band.id)
    expect(release.products.find((p) => p.format === 'vinyl')!.tracks.map((t) => t.side)).toEqual([
      'A',
      'B'
    ])

    // the measure: the label pays and is the partner, linked to the release
    const measures = container.resolve(MarketingActionService).list({ releaseId: release.id })
    expect(measures).toHaveLength(1)
    expect(measures[0]).toMatchObject({
      payer: 'label',
      companyName: 'Beispiel Records',
      costCents: 80000,
      releaseTitle: 'Probealbum',
      kind: 'print_ad'
    })

    // the original is kept as the release's label copy
    const docs = await container.resolve(DocumentService).listByOwner('release', release.id)
    expect(docs.map((d) => d.document_type)).toEqual(['label_copy'])

    // the same file again finds the release by its codes and changes nothing
    const again = await service.plan(file(xlsxPath, 'Probealbum LC.xlsx'))
    expect(again.releaseId).toBe(release.id)
    expect(again.matchedBy).toBe('UPC 4006381333931')
    expect(again.tracks.every((t) => t.status === 'same')).toBe(true)
    expect(again.budget[0].exists).toBe(true)
    const second = await service.apply(
      file(xlsxPath, 'Probealbum LC.xlsx'),
      ApplyLabelCopyInput.parse({ path: xlsxPath, releaseId: release.id, budget: [0] })
    )
    expect(second).toMatchObject({
      tracksAdded: 0,
      tracksUpdated: 0,
      productsAdded: 0,
      productsUpdated: 0,
      measuresAdded: 0,
      documentStored: false
    })
  })

  it('refuses a file it cannot read', async () => {
    const path = join(dir, 'liste.xlsx')
    writeFileSync(path, buildXlsxSheets([{ name: 'Tour', rows: [['Datum', 'Ort']] }]))
    await expect(
      container.resolve(ReleaseImportService).plan({
        bytes: new Uint8Array(readFileSync(path)),
        fileName: 'liste.xlsx',
        path
      })
    ).rejects.toThrow('kennt Bookingium noch nicht')
  })
})
