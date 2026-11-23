import { inject, injectable } from 'tsyringe'
import { readdir, readFile, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { createHash } from 'crypto'
import { fileText } from '../showfolder/fileText'
import { countryNameOf, isPlaceholder } from '../showfolder/address'
import { extractOwnInvoice } from '../showfolder/ownInvoice'
import { IMPORT_COMPANY_NOTE, ShowFolderRepository } from '../repositories/ShowFolderRepository'
import { DocumentService } from './DocumentService'
import { PersonService } from './PersonService'
import { HotelService } from './HotelService'
import { VenueService } from './VenueService'
import { CompanyService } from './CompanyService'
import { CreateCompanyInput } from '../api/schemas/company.schema'
import { DocumentLinkService } from './DocumentLinkService'
import {
  extractContractEvent,
  extractContractParty,
  extractSheetPromoter
} from '../showfolder/contractParty'
import type { DocumentOwnerType } from '../api/schemas/document.schema'
import { ItineraryService } from './ItineraryService'
import { SettlementService } from './SettlementService'
import { scheduleCalendarUpdate } from './CalendarFeedService'
import { readXlsx } from '../import/xlsx'
import { readSettlementSheet } from '../settlement/readSettlementSheet'
import {
  classifyShowFile,
  emptyFacts,
  cleanPlaceName,
  extractShowFacts,
  keyOf,
  mergeShowFacts,
  placeNameOf,
  sameName,
  type ShowFacts,
  type ShowFileInput,
  type ShowFileKind
} from '../showfolder/extract'
import {
  pendingVenueOf,
  planFiles,
  planSuggestions,
  settlementSuggestion,
  type ShowFileRead
} from '../showfolder/plan'
import type {
  ShowFolderAction,
  ShowFolderAnalyzeInput,
  ShowFolderApplyInput,
  ShowFolderApplyResultDto,
  ShowFolderPlanDto
} from '../api/schemas/show_folder.schema'
import type { UpsertItineraryInput } from '../api/schemas/itinerary.schema'

/** At most this many files of a folder are read; a show folder has a handful */
const MAX_FILES = 60
/** Larger files are filed but not read */
const MAX_READ_BYTES = 25 * 1024 * 1024

/**
 * Dropped paths to files: folders are read two levels deep (the archive import reads deeper),
 * hidden and temporary files skipped
 */
export async function expandPaths(
  paths: string[],
  depth = 2,
  maxFiles = MAX_FILES
): Promise<string[]> {
  const files: string[] = []
  const visit = async (path: string, level: number): Promise<void> => {
    if (files.length >= maxFiles) return
    const name = basename(path)
    if (name.startsWith('.') || name.startsWith('~$') || name === 'desktop.ini') return
    let info
    try {
      info = await stat(path)
    } catch {
      return
    }
    if (info.isDirectory()) {
      if (level >= depth) return
      const entries = (await readdir(path)).sort((a, b) => a.localeCompare(b, 'de'))
      for (const entry of entries) await visit(join(path, entry), level + 1)
    } else if (info.isFile()) {
      if (!files.includes(path)) files.push(path)
    }
  }
  for (const path of paths) await visit(path, 0)
  return files
}

/** "Show-Ordner einlesen": reads a show's files and applies what the user ticked */
@injectable()
export class ShowFolderService {
  constructor(
    @inject(ShowFolderRepository) private repository: ShowFolderRepository,
    @inject(DocumentService) private documents: DocumentService,
    @inject(PersonService) private persons: PersonService,
    @inject(HotelService) private hotels: HotelService,
    @inject(ItineraryService) private itineraries: ItineraryService,
    @inject(SettlementService) private settlements: SettlementService,
    @inject(VenueService) private venues: VenueService,
    @inject(CompanyService) private companies: CompanyService,
    @inject(DocumentLinkService) private documentLinks: DocumentLinkService
  ) {}

  /**
   * One file's text (fileText.ts: PDF, mail, Word, Pages, plain text); an Excel sheet only says
   * whether it is a settlement. `sha` finds the same file twice; `dirs` are the folders it lies in.
   */
  private async readOne(
    path: string
  ): Promise<{ input: ShowFileInput; settlement: boolean; sha: string }> {
    const name = basename(path)
    const extension = extname(name).toLowerCase()
    const parent = dirname(path)
    const dirs = [basename(parent), basename(dirname(parent))]
    const empty = { input: { name, text: '', links: [], dirs }, settlement: false, sha: '' }
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      return empty
    }
    if (size > MAX_READ_BYTES) return empty
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch {
      return empty
    }
    const sha = createHash('sha256').update(bytes).digest('hex')
    if (extension === '.xlsx') {
      try {
        const { records } = readXlsx(bytes)
        const settlement = readSettlementSheet(records) !== null
        return {
          input: { name, text: settlement ? 'KONZERTABRECHNUNG' : '', links: [], dirs },
          settlement,
          sha
        }
      } catch {
        return { ...empty, sha }
      }
    }
    const { text, links } = await fileText(extension, bytes)
    return { input: { name, text, links, dirs }, settlement: false, sha }
  }

  /**
   * Reads the files of a show and merges what they say. `asContract`: a filed contract is read as
   * one, whatever its name says. Also used by the archive import before an event exists.
   */
  async readFolder(
    paths: string[],
    bandName: string,
    ownNames: string[],
    asContract = false
  ): Promise<{
    read: Array<ShowFileRead & { facts: ShowFacts }>
    facts: ShowFacts
    settlementFile: { path: string; name: string } | null
  }> {
    const names = paths.map((path) => basename(path))
    const read: Array<ShowFileRead & { facts: ShowFacts }> = []
    let settlementFile: { path: string; name: string } | null = null
    const seen = new Set<string>()
    // of two equal files the original is kept, not its copy ("… [1].pdf", "… Kopie.pdf")
    const isCopy = (path: string) => /(\[\d+\]|\(\d+\)|\bkopie\b|\bcopy\b)/i.test(basename(path))
    const ordered = [...paths].sort((a, b) => Number(isCopy(a)) - Number(isCopy(b)))
    for (const path of ordered) {
      const { input: file, settlement, sha } = await this.readOne(path)
      // the same file twice (a copy "[1]", or in two subfolders): read and filed once
      if (sha && seen.has(sha)) {
        read.push({
          path,
          name: file.name,
          kind: 'duplicate',
          readable: false,
          sameContent: true,
          facts: emptyFacts()
        })
        continue
      }
      if (sha) seen.add(sha)
      let kind: ShowFileKind = classifyShowFile(file, names)
      // travel papers are personal: nothing is read from them
      if (kind === 'travel') {
        read.push({ path, name: file.name, kind, readable: true, facts: emptyFacts() })
        continue
      }
      if (extname(path).toLowerCase() === '.xlsx' && !settlement && kind === 'settlement')
        kind = 'other'
      if (settlement) {
        kind = 'settlement'
        settlementFile ??= { path, name: file.name }
      }
      if (asContract && kind !== 'settlement') kind = 'contract'
      // a rider that never names the band is the venue's or festival's own (tech specs, house
      // rules): read like a venue sheet; the band's own rider says who it is for
      if (kind === 'rider') {
        const band = keyOf(bandName).replace(/ /g, '')
        const named = keyOf(`${file.name} ${file.text.slice(0, 3000)}`).replace(/ /g, '')
        if (band.length >= 3 && !named.includes(band)) kind = 'venue_spec'
      }
      const facts = extractShowFacts(file, kind, bandName)
      if (kind === 'invoice' || kind === 'other') {
        facts.invoice = extractOwnInvoice(file.text, ownNames)
        if (facts.invoice) kind = 'invoice'
      }
      if (kind === 'contract') {
        // a contract form names the show in a column of labels and values
        const show = extractContractEvent(file.text)
        if (show) facts.contractDate = show.date
        if (show?.eventName) facts.eventName = cleanPlaceName(show.eventName)
        // "Veranstaltungsort: Musterstadt" is the town; the event's own name names the place
        const townOnly =
          show !== null && facts.venue.name !== '' && sameName(facts.venue.name, show.city)
        if (show?.eventName && (!facts.venue.name || townOnly)) {
          facts.venue.name = cleanPlaceName(show.eventName)
          facts.venue.zipCode ||= show.zipCode
          facts.venue.city ||= show.city
          if (show.location && !isPlaceholder(show.location))
            facts.venue.notes.push(`Gelände: ${show.location}`)
        }
        // a club's contract: no festival named, the location is the club ("Location: Muster-Haus")
        const club = show?.location ? cleanPlaceName(show.location) : ''
        if (!facts.venue.name && club && !/gelaende|platz|wiese|stadion|park/.test(keyOf(club))) {
          facts.venue.name = club
          facts.venue.notes = facts.venue.notes.filter((note) => note !== `Gelände: ${club}`)
        }
        facts.promoter = extractContractParty(file.text, file.links)
        const party = facts.promoter
        if (party?.contactName && (party.email || party.phone))
          facts.contacts.push({
            role: party.contactRole,
            name: party.contactName,
            email: party.email,
            phone: party.phone,
            side: 'promoter',
            onSite: false
          })
      }
      // a festival's or club's info sheet names its promoter ("Veranstalter: …") too
      if (kind === 'daysheet' || kind === 'venue_spec' || kind === 'other') {
        facts.promoter = extractSheetPromoter(file.text, file.links)
        const party = facts.promoter
        if (party?.contactName && (party.email || party.phone))
          facts.contacts.push({
            role: party.contactRole,
            name: party.contactName,
            email: party.email,
            phone: party.phone,
            side: 'promoter',
            onSite: false
          })
      }
      read.push({ path, name: file.name, kind, readable: file.text.trim().length > 0, facts })
    }
    const facts = mergeShowFacts(read)
    // the contract names the promoter, our invoice to the same company has its address
    const recipient = facts.invoice?.recipient
    if (facts.promoter && recipient && sameName(facts.promoter.name, recipient.name)) {
      const promoter = facts.promoter
      if (!promoter.street && !promoter.zipCode) {
        promoter.street = recipient.street
        promoter.zipCode = recipient.zipCode
        promoter.city = recipient.city
        promoter.countryCode ||= recipient.countryCode
      }
      promoter.vatId ||= recipient.vatId
    }
    // the fee of our invoice when no contract names a guarantee
    if (facts.deal.guaranteeCents === null && facts.invoice?.feeCents)
      facts.deal.guaranteeCents = facts.invoice.feeCents
    return { read, facts, settlementFile }
  }

  async analyze(
    input: ShowFolderAnalyzeInput,
    options: { depth?: number; maxFiles?: number; placeName?: string } = {}
  ): Promise<ShowFolderPlanDto> {
    return (await this.analyzeWithFacts(input, options)).plan
  }

  /** The plan and the facts it was made from (the archive import corrects records with them) */
  async analyzeWithFacts(
    input: ShowFolderAnalyzeInput,
    /**
     * #262 archive import: a whole booking folder, read deeper; `placeName` is the festival as
     * the folder is named, which spells a name the files tore apart
     */
    options: { depth?: number; maxFiles?: number; placeName?: string } = {}
  ): Promise<{ plan: ShowFolderPlanDto; facts: ShowFacts }> {
    // callers inside main pass the input unparsed, without the default
    const documentId = input.documentId ?? null
    const event = this.repository.event(input.eventId)
    if (!event) throw new Error('Event nicht gefunden')
    let paths = await expandPaths(input.paths, options.depth, options.maxFiles)
    if (documentId !== null) {
      const filed = await this.documents.getFullPath(documentId)
      if (!filed) throw new Error('Dokument nicht gefunden')
      paths = [filed.filePath]
    }
    if (paths.length === 0) throw new Error('Keine Dateien gefunden.')
    const bandName = event.bandName ?? ''
    const { read, facts, settlementFile } = await this.readFolder(
      paths,
      bandName,
      this.repository.ownNames(input.eventId),
      documentId !== null
    )
    if (options.placeName)
      facts.venue.name = placeNameOf(facts.venue.name, options.placeName, facts.eventName)
    const firstOf = (...kinds: ShowFileKind[]) =>
      read.find((file) => kinds.includes(file.kind))?.name ?? ''
    const sources = {
      sheet: firstOf('daysheet') || firstOf('mail', 'other'),
      venue: firstOf('venue_spec') || firstOf('daysheet'),
      mail: firstOf('mail') || firstOf('daysheet'),
      contract: firstOf('contract'),
      settlement: settlementFile?.name ?? '',
      invoice: firstOf('invoice')
    }
    const current = this.repository.current(
      input.eventId,
      facts.hotel.name,
      facts.contacts.map((contact) => contact.email),
      facts.venue.name,
      facts.promoter?.name ?? '',
      facts.invoice?.recipient.name ?? ''
    )
    if (!current) throw new Error('Event nicht gefunden')
    const pending = pendingVenueOf(facts, current)

    const suggestions = planSuggestions(facts, current, sources)
    const settlement = settlementSuggestion(settlementFile, current.hasSettlement)
    if (settlement) suggestions.push(settlement)

    const hints: string[] = []
    if (!current.venue && !pending)
      hints.push(
        'Das Event hat keinen Club und kein Festival, und die Dateien nennen keins: Kapazität, Adresse und Ansprechpartner werden erst vorgeschlagen, wenn eins zugeordnet ist.'
      )
    if (current.venue && facts.venue.kind && facts.venue.kind !== current.venue.kind)
      hints.push(
        facts.venue.kind === 'festival'
          ? `Die Dateien beschreiben ein Festival, ${current.venue.name} ist aber als Club gespeichert.`
          : `Die Dateien beschreiben einen Club, ${current.venue.name} ist aber als Festival gespeichert.`
      )
    if (!bandName)
      hints.push(
        'Das Event hat keine Band: Hauptact und Vorgruppe sind nicht sicher zu unterscheiden.'
      )
    const scans = read.filter((file) => !file.readable && file.kind !== 'duplicate')
    if (scans.length > 0)
      hints.push(
        `${scans.length === 1 ? '1 Datei hat' : `${scans.length} Dateien haben`} keinen lesbaren Text (Scan oder anderes Format) und ${scans.length === 1 ? 'wird' : 'werden'} nur abgelegt.`
      )
    if (suggestions.length === 0)
      hints.push('In den Dateien steht nichts, was nicht schon beim Event gespeichert ist.')

    const plan: ShowFolderPlanDto = {
      eventId: input.eventId,
      documentId,
      bandName,
      venueName: current.venue?.name ?? pending?.name ?? '',
      venueKind: current.venue?.kind ?? pending?.kind ?? 'venue',
      // a filed contract stays where it is; only dropped files are filed
      files: documentId !== null ? [] : planFiles(read, current, pending),
      suggestions,
      hints
    }
    return { plan, facts }
  }

  /**
   * Applies the ticked suggestions and files the ticked documents. Each step stands alone: one
   * that fails is reported, the others still run.
   */
  async apply(input: ShowFolderApplyInput): Promise<ShowFolderApplyResultDto> {
    const documentId = input.documentId ?? null
    const event = this.repository.event(input.eventId)
    if (!event) throw new Error('Event nicht gefunden')
    const problems: string[] = []
    let changes = 0
    const attempt = async (what: string, work: () => Promise<void> | void) => {
      try {
        await work()
        changes++
      } catch (error) {
        problems.push(`${what}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // the day in one write
    const itinerary: UpsertItineraryInput = { dealMemoId: input.eventId }
    const times = input.actions.filter(
      (action): action is Extract<ShowFolderAction, { type: 'itinerary' }> =>
        action.type === 'itinerary'
    )
    for (const action of times) itinerary[action.field] = action.value
    if (times.length > 0)
      await attempt('Tagesablauf', () => this.itineraries.upsert(itinerary).then(() => {}))

    // the club or festival first: the venue's data, people and files below go to it
    let venueId = event.venueId
    for (const action of input.actions) {
      if (action.type !== 'venueAssign' || venueId !== null) continue
      await attempt(action.name, async () => {
        let id = action.venueId
        if (id === null) {
          const created = await this.venues.createVenue({
            name: action.name,
            kind: action.kind,
            capacity: action.capacity,
            genres: '',
            notes: action.notes,
            address: {
              street: action.street,
              streetNumber: action.streetNumber,
              addressSuffix: '',
              zipCode: action.zipCode,
              city: action.city,
              state: '',
              country: countryNameOf(action.countryCode),
              countryCode: action.countryCode
            }
          })
          id = created.id
        }
        this.repository.setVenue(input.eventId, id)
        venueId = id
      })
    }

    // the contract's promoter company: persons below become its Ansprechpartner
    let companyId: number | null = null
    for (const action of input.actions) {
      if (action.type !== 'company') continue
      await attempt(action.name, async () => {
        let id = action.companyId
        if (id === null) {
          const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(action.email) ? action.email : ''
          const created = await this.companies.createCompany(
            CreateCompanyInput.parse({
              name: action.name,
              vatId: action.vatId,
              notes: IMPORT_COMPANY_NOTE,
              address: {
                street: action.street,
                streetNumber: action.streetNumber,
                addressSuffix: '',
                zipCode: action.zipCode,
                city: action.city,
                state: '',
                country: countryNameOf(action.countryCode),
                countryCode: action.countryCode
              },
              contact: { email, phone: action.phone, mobilePhone: '', homepage: action.website }
            })
          )
          id = created.id
        }
        // a known company (or the one just made) gets what the files add to its empty fields
        changes += this.repository.fillCompanyGaps(id, {
          street: action.street,
          streetNumber: action.streetNumber,
          zipCode: action.zipCode,
          city: action.city,
          countryCode: action.countryCode,
          email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(action.email) ? action.email : '',
          phone: action.phone,
          website: action.website,
          vatId: action.vatId,
          taxNumber: action.taxNumber,
          kskNumber: action.kskNumber
        })
        if (action.lopro) this.repository.setLoproCompany(input.eventId, id)
        if (action.invoiceCompany) this.repository.setInvoiceCompany(input.eventId, id)
        if (action.lopro || companyId === null) companyId = id
      })
    }

    // the persons the ticked suggestions name, for the contract's links
    const personIds: number[] = []
    for (const action of input.actions) {
      switch (action.type) {
        case 'itinerary':
        case 'venueAssign':
        case 'company':
          break
        case 'venueKind':
          if (venueId !== null) {
            const id = venueId
            await attempt('Club / Festival', () => this.repository.setVenueKind(id, action.kind))
          }
          break
        case 'eventPresale':
          await attempt('Ticketpreis', () =>
            this.repository.setPresale(input.eventId, action.cents)
          )
          break
        case 'eventGuarantee':
          await attempt('Garantie', () => this.repository.setGuarantee(input.eventId, action.cents))
          break
        case 'eventDeal':
          await attempt('Deal', () => this.repository.setDeal(input.eventId, action.text))
          break
        case 'venueCapacity':
          if (venueId !== null) {
            const id = venueId
            await attempt('Kapazität', () => this.repository.setVenueCapacity(id, action.value))
          }
          break
        case 'venueAddress':
          if (venueId !== null) {
            const id = venueId
            await attempt('Adresse', () => this.repository.setVenueAddress(id, action))
          }
          break
        case 'venueNotes':
          if (venueId !== null) {
            const id = venueId
            await attempt('Infos', () =>
              this.repository.appendVenueNotes(
                id,
                `Aus dem Show-Ordner (${new Date().toLocaleDateString('de-DE')}):`,
                action.lines
              )
            )
          }
          break
        case 'hotel':
          await attempt(`Hotel ${action.name}`, async () => {
            let hotelId = action.hotelId
            if (hotelId === null) {
              const created = await this.hotels.createHotel({
                name: action.name,
                notes: action.notes,
                address: {
                  street: action.street,
                  streetNumber: action.streetNumber,
                  addressSuffix: '',
                  zipCode: action.zipCode,
                  city: action.city,
                  state: '',
                  country: countryNameOf(action.countryCode),
                  countryCode: action.countryCode
                }
              })
              hotelId = created.id
            }
            this.repository.setHotel(input.eventId, hotelId)
          })
          break
        case 'person':
          await attempt(`Kontakt ${action.firstName} ${action.lastName}`.trim(), async () => {
            let personId = action.personId
            if (personId === null) {
              const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(action.email) ? action.email : ''
              const created = await this.persons.createPerson({
                firstName: action.firstName,
                lastName: action.lastName,
                birthday: null,
                notes: action.role ? `Rolle laut Show-Ordner: ${action.role}` : null,
                contact: {
                  email,
                  phone: action.phone,
                  mobilePhone: '',
                  homepage: ''
                }
              })
              personId = created.id
            }
            if (action.venueMember && venueId !== null)
              this.repository.addVenueMember(venueId, personId, action.role)
            if (action.localContact) this.repository.setLocalContact(input.eventId, personId)
            if (action.lopro) this.repository.setLopro(input.eventId, personId)
            if (action.companyMember && companyId !== null)
              this.repository.addCompanyMember(companyId, personId, action.role)
            personIds.push(personId)
          })
          break
        case 'settlement':
          await attempt('Abrechnung', async () => {
            const sheet = await this.settlements.readFile(action.path)
            this.settlements.save({
              eventId: input.eventId,
              input: sheet.input,
              sourceFileName: sheet.fileName
            })
          })
          break
      }
    }

    let documents = 0
    for (const file of input.files) {
      // a venue's file goes to the event when the event has no club or festival after all
      const ownerType = file.owner === 'venue' && venueId !== null ? 'venue' : 'event'
      const ownerId = ownerType === 'venue' && venueId !== null ? venueId : input.eventId
      try {
        await this.documents.upload({
          ownerType,
          ownerId,
          sourcePath: file.path,
          documentType: file.documentType
        })
        documents++
      } catch (error) {
        problems.push(
          `${basename(file.path)}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    // the read contract belongs to the records it names, not only to the event
    let links = 0
    if (documentId !== null) {
      const targets: Array<{ kind: DocumentOwnerType; id: number }> = [
        { kind: 'event', id: input.eventId },
        ...(event.bandId !== null ? [{ kind: 'band' as const, id: event.bandId }] : []),
        ...(venueId !== null ? [{ kind: 'venue' as const, id: venueId }] : []),
        ...(companyId !== null ? [{ kind: 'company' as const, id: companyId }] : []),
        ...personIds.map((id) => ({ kind: 'person' as const, id }))
      ]
      try {
        const document = await this.documents.getById(documentId)
        const others = targets.filter(
          (target) => !(document?.owner_type === target.kind && document.owner_id === target.id)
        )
        this.documentLinks.linkAll(documentId, others)
        links = others.length
      } catch (error) {
        problems.push(`Vertrag zuordnen: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (changes > 0) scheduleCalendarUpdate()
    return { documents, changes, links, problems }
  }
}
