import { inject, injectable } from 'tsyringe'
import { readdir, readFile, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { simpleParser } from 'mailparser'
import { ShowFolderRepository } from '../repositories/ShowFolderRepository'
import { DocumentService } from './DocumentService'
import { PersonService } from './PersonService'
import { HotelService } from './HotelService'
import { ItineraryService } from './ItineraryService'
import { SettlementService } from './SettlementService'
import { scheduleCalendarUpdate } from './CalendarFeedService'
import { readXlsx } from '../import/xlsx'
import { readSettlementSheet } from '../settlement/readSettlementSheet'
import {
  classifyShowFile,
  extractShowFacts,
  mergeShowFacts,
  type ShowFacts,
  type ShowFileInput,
  type ShowFileKind
} from '../showfolder/extract'
import {
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

type TextItem = { str?: string; hasEOL?: boolean }

/** A PDF's text and its link targets (mailto: and web links survive broken ligatures) */
async function pdfTextAndLinks(bytes: Uint8Array): Promise<{ text: string; links: string[] }> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0
    })
    const pdf = await task.promise
    const pages: string[] = []
    const links: string[] = []
    for (let number = 1; number <= Math.min(pdf.numPages, 10); number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      pages.push(
        (content.items as TextItem[])
          .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ' '))
          .join('')
      )
      for (const annotation of (await page.getAnnotations()) as Array<{ url?: string }>)
        if (annotation.url) links.push(annotation.url)
    }
    await task.destroy()
    return { text: pages.join('\n'), links }
  } catch {
    return { text: '', links: [] }
  }
}

/** A mail as text: the header lines the extraction reads ("Von:", "An:"), then the body */
async function mailText(bytes: Buffer): Promise<{ text: string; links: string[] }> {
  try {
    const mail = await simpleParser(bytes)
    const addresses = (value: typeof mail.to): string =>
      (Array.isArray(value) ? value : value ? [value] : []).map((entry) => entry.text).join(', ')
    const header = [
      mail.from ? `Von: ${mail.from.text}` : '',
      mail.to ? `An: ${addresses(mail.to)}` : '',
      mail.subject ? `Betreff: ${mail.subject}` : ''
    ].filter(Boolean)
    const links = [...(mail.text ?? '').matchAll(/mailto:[^\s>"]+/gi)].map((match) => match[0])
    return { text: [...header, '', mail.text ?? ''].join('\n'), links }
  } catch {
    return { text: '', links: [] }
  }
}

/** Dropped paths to files: folders are read two levels deep, hidden and temporary files skipped */
export async function expandPaths(paths: string[], depth = 2): Promise<string[]> {
  const files: string[] = []
  const visit = async (path: string, level: number): Promise<void> => {
    if (files.length >= MAX_FILES) return
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
    @inject(SettlementService) private settlements: SettlementService
  ) {}

  /** One file's text: PDF, mail, plain text; an Excel sheet only says whether it is a settlement */
  private async readOne(path: string): Promise<{ input: ShowFileInput; settlement: boolean }> {
    const name = basename(path)
    const extension = extname(name).toLowerCase()
    const empty = { input: { name, text: '', links: [] }, settlement: false }
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      return empty
    }
    if (size > MAX_READ_BYTES) return empty
    if (extension === '.pdf') {
      const { text, links } = await pdfTextAndLinks(await readFile(path))
      return { input: { name, text, links }, settlement: false }
    }
    if (extension === '.eml') {
      const { text, links } = await mailText(await readFile(path))
      return { input: { name, text, links }, settlement: false }
    }
    if (extension === '.txt') {
      return { input: { name, text: await readFile(path, 'utf-8'), links: [] }, settlement: false }
    }
    if (extension === '.xlsx') {
      try {
        const { records } = readXlsx(await readFile(path))
        const settlement = readSettlementSheet(records) !== null
        return {
          input: { name, text: settlement ? 'KONZERTABRECHNUNG' : '', links: [] },
          settlement
        }
      } catch {
        return empty
      }
    }
    return empty
  }

  async analyze(input: ShowFolderAnalyzeInput): Promise<ShowFolderPlanDto> {
    const event = this.repository.event(input.eventId)
    if (!event) throw new Error('Event nicht gefunden')
    const paths = await expandPaths(input.paths)
    if (paths.length === 0) throw new Error('Keine Dateien gefunden.')
    const names = paths.map((path) => basename(path))
    const bandName = event.bandName ?? ''

    const read: Array<ShowFileRead & { facts: ShowFacts }> = []
    let settlementFile: { path: string; name: string } | null = null
    for (const path of paths) {
      const { input: file, settlement } = await this.readOne(path)
      let kind: ShowFileKind = classifyShowFile(file, names)
      if (extname(path).toLowerCase() === '.xlsx' && !settlement && kind === 'settlement')
        kind = 'other'
      if (settlement) {
        kind = 'settlement'
        settlementFile ??= { path, name: file.name }
      }
      read.push({
        path,
        name: file.name,
        kind,
        readable: file.text.trim().length > 0,
        facts: extractShowFacts(file, kind, bandName)
      })
    }

    const facts = mergeShowFacts(read)
    const firstOf = (...kinds: ShowFileKind[]) =>
      read.find((file) => kinds.includes(file.kind))?.name ?? ''
    const sources = {
      sheet: firstOf('daysheet') || firstOf('mail', 'other'),
      venue: firstOf('venue_spec') || firstOf('daysheet'),
      mail: firstOf('mail') || firstOf('daysheet'),
      contract: firstOf('contract'),
      settlement: settlementFile?.name ?? ''
    }
    const current = this.repository.current(
      input.eventId,
      facts.hotel.name,
      facts.contacts.map((contact) => contact.email)
    )
    if (!current) throw new Error('Event nicht gefunden')

    const suggestions = planSuggestions(facts, current, sources)
    const settlement = settlementSuggestion(settlementFile, current.hasSettlement)
    if (settlement) suggestions.push(settlement)

    const hints: string[] = []
    if (!current.venue)
      hints.push(
        'Das Event hat keinen Club: Angaben zum Club (Kapazität, Adresse, Ansprechpartner) werden erst vorgeschlagen, wenn einer zugeordnet ist.'
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

    return {
      eventId: input.eventId,
      bandName,
      venueName: current.venue?.name ?? '',
      files: planFiles(read, current),
      suggestions,
      hints
    }
  }

  /**
   * Applies the ticked suggestions and files the ticked documents. Each step stands alone: one
   * that fails is reported, the others still run.
   */
  async apply(input: ShowFolderApplyInput): Promise<ShowFolderApplyResultDto> {
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

    const venueId = event.venueId
    for (const action of input.actions) {
      switch (action.type) {
        case 'itinerary':
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
          if (venueId !== null)
            await attempt('Kapazität', () =>
              this.repository.setVenueCapacity(venueId, action.value)
            )
          break
        case 'venueAddress':
          if (venueId !== null)
            await attempt('Adresse des Clubs', () =>
              this.repository.setVenueAddress(venueId, action)
            )
          break
        case 'venueNotes':
          if (venueId !== null)
            await attempt('Infos zum Club', () =>
              this.repository.appendVenueNotes(
                venueId,
                `Aus dem Show-Ordner (${new Date().toLocaleDateString('de-DE')}):`,
                action.lines
              )
            )
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
                  country: '',
                  countryCode: ''
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
      const ownerId = file.owner === 'venue' ? venueId : input.eventId
      if (ownerId === null) {
        problems.push(`${basename(file.path)}: Das Event hat keinen Club.`)
        continue
      }
      try {
        await this.documents.upload({
          ownerType: file.owner,
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

    if (changes > 0) scheduleCalendarUpdate()
    return { documents, changes, problems }
  }
}
