import { inject, injectable } from 'tsyringe'
import { ShowFolderRepository } from '../repositories/ShowFolderRepository'
import { ShowFolderService, expandPaths } from './ShowFolderService'
import { scheduleCalendarUpdate } from './CalendarFeedService'
import { findShowFolders, parseShowFolderName } from '../archive/showFolders'
import { placeNameOf } from '../showfolder/extract'
import { basename } from 'path'
import { localIsoDate } from './OpenItemsService'
import type {
  ArchiveApplyInput,
  ArchiveApplyResultDto,
  ArchivePreviewDto,
  ArchivePreviewInput,
  ArchiveScanInput,
  ArchiveShowDto
} from '../api/schemas/archive.schema'

/** A booking folder is read this deep and up to this many files (a cruise has dozens) */
const ARCHIVE_DEPTH = 5
const ARCHIVE_MAX_FILES = 200

/** The show as its folder is named ("2023-08-12 Musterdorf - Muster Open Air" → the part after the date) */
const folderTitle = (path: string): string => parseShowFolderName(basename(path)).title

/** The kinds of files the archive import files when asked to: the contract and our invoice */
const FILED_KINDS = new Set(['contract', 'invoice'])

const germanDate = (iso: string) => iso.split('-').reverse().join('.')

/**
 * "Booking-Archiv einlesen" (#262 follow-up): a band's old booking folders, many at once. Each
 * show runs through the Show-Ordner import (ShowFolderService) with the same recognition; here
 * it gets its event first (found by band and date, or created: confirmed, archived when past),
 * and only what fills empty fields is applied.
 */
@injectable()
export class ArchiveImportService {
  constructor(
    @inject(ShowFolderRepository) private repository: ShowFolderRepository,
    @inject(ShowFolderService) private showFolders: ShowFolderService
  ) {}

  async scan(input: ArchiveScanInput): Promise<ArchiveShowDto[]> {
    const shows = await findShowFolders(input.root)
    if (shows.length === 0) throw new Error('In diesem Ordner wurden keine Show-Ordner gefunden.')
    return shows.map((show) => {
      const event = show.date ? this.repository.eventOn(input.bandId, show.date) : null
      return {
        path: show.path,
        folderName: show.name,
        date: show.date,
        endDate: show.endDate,
        title: show.title,
        eventId: event?.id ?? null,
        eventName: event?.name ?? null
      }
    })
  }

  /** What a show folder holds, before anything is stored */
  async preview(input: ArchivePreviewInput): Promise<ArchivePreviewDto> {
    const paths = await expandPaths([input.path], ARCHIVE_DEPTH, ARCHIVE_MAX_FILES)
    const bandName = this.repository.ownNamesOfBand(input.bandId)[0] ?? ''
    const { read, facts } = await this.showFolders.readFolder(
      paths,
      bandName,
      this.repository.ownNamesOfBand(input.bandId)
    )
    const count = (kind: string) => read.filter((file) => file.kind === kind).length
    facts.venue.name = placeNameOf(facts.venue.name, folderTitle(input.path))
    const place = facts.venue.name ? this.repository.venueByName(facts.venue.name) : null
    const named = (name: string | undefined) =>
      name ? { name, known: this.repository.companyByName(name) !== null } : null
    return {
      place: {
        name: place?.name ?? facts.venue.name,
        known: place !== null,
        kind: place?.kind ?? facts.venue.kind ?? 'festival'
      },
      promoter: named(facts.promoter?.name),
      recipient: named(facts.invoice?.recipient.name),
      guaranteeCents: facts.deal.guaranteeCents,
      contractDate: facts.contractDate,
      files: {
        total: read.length,
        contracts: count('contract'),
        invoices: count('invoice'),
        travel: count('travel'),
        duplicates: count('duplicate'),
        unreadable: read.filter(
          (file) => !file.readable && file.kind !== 'duplicate' && file.kind !== 'travel'
        ).length
      }
    }
  }

  /** One show: its event, then every suggestion that fills an empty field, then the files */
  async apply(input: ArchiveApplyInput): Promise<ArchiveApplyResultDto> {
    let eventId = input.eventId ?? this.repository.eventOn(input.bandId, input.date)?.id ?? null
    const createdEvent = eventId === null
    if (eventId === null) {
      eventId = this.repository.createArchivedEvent({
        bandId: input.bandId,
        name: input.eventName,
        date: input.date,
        notes: [
          input.endDate ? `Bis ${germanDate(input.endDate)}.` : '',
          'Aus dem Booking-Archiv eingelesen.'
        ]
          .filter(Boolean)
          .join(' '),
        archived: (input.endDate || input.date) < localIsoDate(new Date())
      })
    }
    const plan = await this.showFolders.analyze(
      { eventId, paths: [input.path], documentId: null },
      { depth: ARCHIVE_DEPTH, maxFiles: ARCHIVE_MAX_FILES, placeName: folderTitle(input.path) }
    )
    // only what fills something empty: a stored value is never changed by an old folder
    const actions = plan.suggestions
      .filter((suggestion) => suggestion.include)
      .map((suggestion) => suggestion.action)
    const files = input.fileDocuments
      ? plan.files
          .filter((file) => file.include && FILED_KINDS.has(file.kind))
          .map((file) => ({
            path: file.path,
            owner: file.owner === 'venue' ? ('venue' as const) : ('event' as const),
            documentType: file.documentType
          }))
      : []
    const result = await this.showFolders.apply({ eventId, files, actions, documentId: null })
    scheduleCalendarUpdate()
    return {
      eventId,
      createdEvent,
      changes: result.changes,
      documents: result.documents,
      problems: result.problems
    }
  }
}
