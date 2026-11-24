import { inject, injectable } from 'tsyringe'
import { basename, extname } from 'path'
import { ReleaseRepository } from '../repositories/ReleaseRepository'
import { MarketingActionRepository } from '../repositories/MarketingActionRepository'
import { DocumentService } from './DocumentService'
import { ReleaseMapper } from '../api/mappers/release.mapper'
import { readXlsxSheets } from '../import/xlsx'
import { pdfText } from '../einvoice/pdfText'
import { parseExcelLabelCopy } from '../release/import/excelTemplate'
import { parseOpenPlayLabelCopy } from '../release/import/openplayPdf'
import {
  budgetKey,
  labelCopyCodes,
  matchProduct,
  matchTrack,
  mergeCredits,
  mergeHead,
  mergeProduct,
  mergeTrack,
  planLabelCopy
} from '../release/import/plan'
import type { ReleaseDetailDto } from '../api/schemas/release.schema'
import type {
  ApplyLabelCopyData,
  ApplyLabelCopyResult,
  LabelCopyPlanDto,
  ParsedLabelCopy
} from '../api/schemas/release_import.schema'

/**
 * The bytes of a label copy, read by the router: a picked file (its path) or a mail attachment
 * (the account and the mail's Message-ID, kept with the stored document)
 */
export type LabelCopyFile = {
  bytes: Uint8Array
  fileName: string
  path: string | null
  mail: { accountId: string; messageId: string | null } | null
}

/** Thrown for a file that is no label copy this app reads; the router answers BAD_REQUEST */
export class LabelCopyError extends Error {}

/**
 * #289: reads a label copy (Excel template or OpenPlay PDF report), shows what it would change
 * in a release and merges it in; the file itself is kept with the release.
 */
@injectable()
export class ReleaseImportService {
  constructor(
    @inject(ReleaseRepository) private releases: ReleaseRepository,
    @inject(MarketingActionRepository) private measures: MarketingActionRepository,
    @inject(DocumentService) private documents: DocumentService
  ) {}

  async parse(file: LabelCopyFile): Promise<ParsedLabelCopy> {
    const extension = extname(file.fileName).slice(1).toLowerCase()
    let parsed: ParsedLabelCopy | null = null
    if (extension === 'xlsx') {
      parsed = parseExcelLabelCopy(readXlsxSheets(Buffer.from(file.bytes), 30))
    } else if (extension === 'pdf') {
      const text = await pdfText(file.bytes, 80)
      if (!text.trim())
        throw new LabelCopyError(
          'Die PDF enthält keinen Text (vermutlich ein Scan). Lege sie als Dokument ab und trage die Angaben von Hand ein.'
        )
      parsed = parseOpenPlayLabelCopy(text)
    }
    if (!parsed)
      throw new LabelCopyError(
        'Das Format dieser Labelcopy kennt Bookingium noch nicht. Lege die Datei als Dokument am Release ab und trage die Angaben von Hand ein.'
      )
    return parsed
  }

  private async detail(id: number): Promise<ReleaseDetailDto | null> {
    const row = await this.releases.getDetail(id)
    return row ? ReleaseMapper.toDetailDto(row) : null
  }

  /** The release the copy goes into: the given one, none (new), or found by its codes */
  private async target(parsed: ParsedLabelCopy, releaseId: number | null | undefined) {
    if (releaseId === null) return { release: null, matchedBy: null }
    if (releaseId !== undefined) {
      const release = await this.detail(releaseId)
      if (!release) throw new LabelCopyError('Release nicht gefunden')
      return { release, matchedBy: null }
    }
    const found = await this.releases.findByCodes(labelCopyCodes(parsed))
    if (!found) return { release: null, matchedBy: null }
    return { release: await this.detail(found.id), matchedBy: found.via }
  }

  async plan(file: LabelCopyFile, releaseId?: number | null): Promise<LabelCopyPlanDto> {
    const parsed = await this.parse(file)
    const { release, matchedBy } = await this.target(parsed, releaseId)
    const existing = release ? this.measures.list({ releaseId: release.id }) : []
    const parts = planLabelCopy(
      parsed,
      release,
      existing.map((row) => ({ kind: row.action.kind, title: row.action.title }))
    )
    return {
      fileName: file.fileName,
      source: parsed.source,
      releaseId: release?.id ?? null,
      releaseTitle: release?.title ?? null,
      matchedBy,
      suggestedBandId: release ? null : await this.releases.bandIdByName(parsed.head.artistName),
      ...parts,
      canImportBudget: release ? release.bandId !== null : true,
      warnings: parsed.warnings
    }
  }

  async apply(file: LabelCopyFile, input: ApplyLabelCopyData): Promise<ApplyLabelCopyResult> {
    const parsed = await this.parse(file)
    let release = input.releaseId === null ? null : await this.detail(input.releaseId)
    if (input.releaseId !== null && !release) throw new LabelCopyError('Release nicht gefunden')

    // the head: a new release, or the existing one with empty fields filled
    const created = release === null
    // the label's company, found by the file's label name, for a release without one
    const labelCompanyId = release?.labelCompanyId
      ? null
      : await this.releases.companyIdByName(parsed.head.label || release?.label || '')
    const head = mergeHead(release, parsed.head, input.takeFields, input.bandId, labelCompanyId)
    if (release) await this.releases.update({ ...head, id: release.id })
    const releaseId = release ? release.id : await this.releases.create(head)
    release = (await this.detail(releaseId))!

    const credits = mergeCredits(release.credits, parsed.credits)
    if (credits.length !== release.credits.length)
      await this.releases.saveCredits(releaseId, credits)

    let tracksAdded = 0
    let tracksUpdated = 0
    for (const incoming of parsed.tracks) {
      const current = matchTrack(release.tracks, incoming)
      const merged = mergeTrack(releaseId, current, incoming, input.overwrite)
      if (current && !trackChanged(current, merged)) continue
      await this.releases.saveTrack(merged)
      if (current) tracksUpdated++
      else tracksAdded++
    }

    // the release's track ids by the file's keys, for the tracklists
    release = (await this.detail(releaseId))!
    const trackIds = new Map<string, number>()
    for (const incoming of parsed.tracks) {
      const track = matchTrack(release.tracks, incoming)
      if (track) trackIds.set(incoming.key, track.id)
    }

    let productsAdded = 0
    let productsUpdated = 0
    for (const incoming of parsed.products) {
      const current = matchProduct(release.products, incoming)
      const merged = mergeProduct(releaseId, current, incoming, trackIds, input.overwrite)
      if (current && !productChanged(current, merged)) continue
      await this.releases.saveProduct(merged)
      if (current) productsUpdated++
      else productsAdded++
      // a later product of the same file may match this one by catalogue number
      release = (await this.detail(releaseId))!
    }

    const measuresAdded = await this.addMeasures(release, parsed, input.budget)
    const documentStored = await this.keepFile(releaseId, file)

    return {
      releaseId,
      created,
      tracksAdded,
      tracksUpdated,
      productsAdded,
      productsUpdated,
      measuresAdded,
      documentStored
    }
  }

  /** The chosen budget lines as measures of the band: the label pays, the label is the partner */
  private async addMeasures(
    release: ReleaseDetailDto,
    parsed: ParsedLabelCopy,
    indices: number[]
  ): Promise<number> {
    if (indices.length === 0 || release.bandId === null) return 0
    const known = new Set(
      this.measures
        .list({ releaseId: release.id })
        .map((row) => budgetKey({ kind: row.action.kind, title: row.action.title }))
    )
    const companyId = release.labelCompanyId ?? (await this.releases.companyIdByName(release.label))
    let added = 0
    for (const index of indices) {
      const line = parsed.budget[index]
      if (!line || known.has(budgetKey(line))) continue
      known.add(budgetKey(line))
      this.measures.create({
        bandId: release.bandId,
        kind: line.kind,
        title: line.title,
        status: line.done ? 'done' : 'planned',
        dealMemoId: null,
        tour: '',
        release: release.title,
        releaseId: release.id,
        companyId,
        marketingItemId: null,
        startDate: null,
        endDate: null,
        region: '',
        costCents: line.costCents,
        payer: 'label',
        receiptId: null,
        notes: [line.notes, 'Aus der Labelcopy übernommen'].filter(Boolean).join(' · ')
      })
      added++
    }
    return added
  }

  /** Files the label copy at the release, unless the same file is there already */
  private async keepFile(releaseId: number, file: LabelCopyFile): Promise<boolean> {
    const name = basename(file.fileName, extname(file.fileName)).toLowerCase()
    const existing = await this.documents.listByOwner('release', releaseId)
    const known = existing.some(
      (doc) => doc.file_size === file.bytes.length && doc.file_name.toLowerCase().startsWith(name)
    )
    if (known) return false
    if (file.path) {
      await this.documents.upload({
        ownerType: 'release',
        ownerId: releaseId,
        sourcePath: file.path,
        documentType: 'label_copy'
      })
      return true
    }
    if (!file.mail) return false
    await this.documents.saveFromMail({
      ownerType: 'release',
      ownerId: releaseId,
      fileName: file.fileName,
      documentType: 'label_copy',
      bytes: file.bytes,
      messageId: file.mail.messageId,
      mailAccountId: file.mail.accountId
    })
    return true
  }
}

function trackChanged(
  current: ReleaseDetailDto['tracks'][number],
  merged: ReturnType<typeof mergeTrack>
): boolean {
  const before = JSON.stringify({
    ...pickTrack(current),
    contributors: current.contributors.map((c) => [c.name, c.role, c.instrument]),
    workShares: current.workShares.map((s) => [
      s.name,
      s.role,
      s.sharePercent,
      s.society,
      s.ipi,
      s.publisher,
      s.country
    ])
  })
  const after = JSON.stringify({
    ...pickTrack(merged),
    contributors: merged.contributors.map((c) => [c.name, c.role, c.instrument]),
    workShares: merged.workShares.map((s) => [
      s.name,
      s.role,
      s.sharePercent,
      s.society,
      s.ipi,
      s.publisher,
      s.country
    ])
  })
  return before !== after
}

function pickTrack(t: {
  title: string
  version: string
  durationSeconds: number | null
  isrc: string
  explicit: boolean
  genre: string
  pLine: string
  cLine: string
  videoIsrc: string
  lyrics: string
}) {
  return [
    t.title,
    t.version,
    t.durationSeconds,
    t.isrc,
    t.explicit,
    t.genre,
    t.pLine,
    t.cLine,
    t.videoIsrc,
    t.lyrics
  ]
}

function productChanged(
  current: ReleaseDetailDto['products'][number],
  merged: ReturnType<typeof mergeProduct>
): boolean {
  const fields = (p: typeof merged | typeof current) => [
    p.format,
    p.title,
    p.packaging,
    p.color,
    p.upc,
    p.catalogNumber,
    p.territory,
    p.discCount,
    p.releaseDate,
    p.priceCode,
    p.boxLot,
    p.tracks.map((pt) => [pt.trackId, pt.disc, pt.side])
  ]
  return JSON.stringify(fields(current)) !== JSON.stringify(fields(merged))
}
