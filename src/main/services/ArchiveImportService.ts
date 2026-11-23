import { inject, injectable } from 'tsyringe'
import { ARCHIVE_EVENT_NOTE, ShowFolderRepository } from '../repositories/ShowFolderRepository'
import { CompanyService } from './CompanyService'
import { VenueService } from './VenueService'
import { splitStreet } from '../einvoice/readParty'
import { isPlaceholder } from '../showfolder/address'
import { ShowFolderService, expandPaths } from './ShowFolderService'
import { scheduleCalendarUpdate } from './CalendarFeedService'
import { findShowFolders, parseShowFolderName } from '../archive/showFolders'
import { placeNameOf, type ShowFacts } from '../showfolder/extract'
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
    @inject(ShowFolderService) private showFolders: ShowFolderService,
    @inject(VenueService) private venues: VenueService,
    @inject(CompanyService) private companies: CompanyService
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
        eventName: event?.name ?? null,
        archiveEvent: event ? this.repository.isArchiveEvent(event.id) : false
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
    facts.venue.name = placeNameOf(facts.venue.name, folderTitle(input.path), facts.eventName)
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
        notes: [input.endDate ? `Bis ${germanDate(input.endDate)}.` : '', ARCHIVE_EVENT_NOTE]
          .filter(Boolean)
          .join(' '),
        archived: (input.endDate || input.date) < localIsoDate(new Date())
      })
    }
    // correcting an earlier archive import: the import's own club and companies come off the
    // event, so the files find (or make) the right ones; the user's own records stay
    const correcting = input.correct && !createdEvent && this.repository.isArchiveEvent(eventId)
    const replaced: { venueId: number | null; companyIds: number[] } = {
      venueId: null,
      companyIds: []
    }
    if (correcting) {
      const event = this.repository.event(eventId)
      const venue = event?.venueId ?? null
      const lopro = event?.loproCompanyId ?? null
      const billing = event?.invoiceCompanyId ?? null
      const links = {
        venue: venue !== null && this.repository.isImportVenue(venue),
        lopro: lopro !== null && this.repository.isImportCompany(lopro),
        invoice: billing !== null && this.repository.isImportCompany(billing)
      }
      if (links.venue) replaced.venueId = venue
      if (links.lopro && lopro !== null) replaced.companyIds.push(lopro)
      if (links.invoice && billing !== null) replaced.companyIds.push(billing)
      this.repository.unlinkEvent(eventId, links)
      this.repository.renameEvent(eventId, input.eventName)
    }
    const { plan, facts } = await this.showFolders.analyzeWithFacts(
      { eventId, paths: [input.path], documentId: null },
      { depth: ARCHIVE_DEPTH, maxFiles: ARCHIVE_MAX_FILES, placeName: folderTitle(input.path) }
    )
    // only what fills something empty: a stored value is never changed by an old folder - unless
    // the event is the archive's own and is being corrected: then its day and deal are replaced
    const actions = plan.suggestions
      .filter(
        (suggestion) =>
          suggestion.include ||
          (correcting &&
            (suggestion.group === 'Tagesablauf' || suggestion.group === 'Tickets & Deal'))
      )
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
    let changes = result.changes
    let removed = 0
    if (correcting) {
      changes += this.correctRecords(eventId, facts)
      removed = await this.removeUnused(replaced, result.problems)
    }
    scheduleCalendarUpdate()
    return {
      eventId,
      createdEvent,
      changes,
      documents: result.documents,
      problems: result.problems,
      corrected: correcting,
      removed
    }
  }

  /**
   * The import's own club and companies now on the event get what the files say, also over a
   * wrong stored value ("tba" as the street, the band's address as the club's)
   */
  private correctRecords(eventId: number, facts: ShowFacts): number {
    const event = this.repository.event(eventId)
    if (!event) return 0
    let changes = 0
    if (event.venueId !== null && this.repository.isImportVenue(event.venueId)) {
      const place = facts.venue
      if (place.street || place.zipCode) {
        const { street, streetNumber } = splitStreet(place.street)
        this.repository.setVenueAddress(event.venueId, {
          street,
          streetNumber,
          zipCode: place.zipCode,
          city: place.city,
          countryCode: place.countryCode
        })
        changes++
      } else {
        const stored = this.repository.venue(event.venueId)
        if (stored?.street && isPlaceholder(stored.street)) {
          this.repository.clearVenueAddress(event.venueId)
          changes++
        }
      }
      if (place.capacity !== null) {
        this.repository.setVenueCapacity(event.venueId, place.capacity)
        changes++
      }
    }
    const companyFacts = [
      { id: event.loproCompanyId, party: facts.promoter },
      {
        id: event.invoiceCompanyId,
        party: facts.invoice ? { ...facts.invoice.recipient, email: '', phone: '' } : null
      }
    ]
    for (const { id, party } of companyFacts) {
      if (id === null || !party || !this.repository.isImportCompany(id)) continue
      const { street, streetNumber } = splitStreet(party.street)
      changes += this.repository.replaceCompanyAddress(id, {
        street,
        streetNumber,
        zipCode: party.zipCode,
        city: party.city,
        countryCode: party.countryCode,
        email: party.email,
        phone: party.phone
      })
    }
    return changes
  }

  /** Removes the import's club and companies the correction took off when nothing uses them */
  private async removeUnused(
    replaced: { venueId: number | null; companyIds: number[] },
    problems: string[]
  ): Promise<number> {
    let removed = 0
    const venueId = replaced.venueId
    if (venueId !== null && !this.repository.venueInUse(venueId)) {
      try {
        await this.venues.deleteVenue(venueId)
        removed++
      } catch (error) {
        problems.push(`Alter Eintrag: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const companyId of new Set(replaced.companyIds)) {
      if (this.repository.companyInUse(companyId)) continue
      try {
        await this.companies.deleteCompany(companyId)
        removed++
      } catch (error) {
        problems.push(`Alte Firma: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return removed
  }
}
