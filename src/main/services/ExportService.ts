import { injectable, inject } from 'tsyringe'
import { BandService } from './BandService'
import { BankService } from './BankService'
import { CompanyService } from './CompanyService'
import { DealMemoService } from './DealMemoService'
import { HotelService } from './HotelService'
import { InvoiceService } from './InvoiceService'
import { PersonService } from './PersonService'
import { VenueService } from './VenueService'
import { BandMapper } from '../api/mappers/band.mapper'
import { BankMapper } from '../api/mappers/bank.mapper'
import { CompanyMapper } from '../api/mappers/company.mapper'
import { DealMemoMapper } from '../api/mappers/deal_memo.mapper'
import { HotelMapper } from '../api/mappers/hotel.mapper'
import { InvoiceMapper } from '../api/mappers/invoice.mapper'
import { PersonMapper } from '../api/mappers/person.mapper'
import { VenueMapper } from '../api/mappers/venue.mapper'
import { EXPORT_LIST_LABELS, ExportList, type ExportListInput } from '../api/schemas/export.schema'
import { VENUE_KIND_LABELS } from '../api/schemas/venue.schema'
import type { AddressDto } from '../api/schemas/address.schema'
import type { ContactDto } from '../api/schemas/contact.schema'
import { CSV_BOM, csvSeparator, toCsv } from '../csv/csv'

type Cell = string | number | Date | null

/** Column kinds written in the regional format */
type ColumnKind = 'text' | 'number' | 'date' | 'money'

interface Column {
  header: string
  kind?: ColumnKind
}

export interface ListTable {
  name: string
  columns: Column[]
  rows: Cell[][]
}

// Every row of the list: the grid's own query with a page size that fits all
const ALL = { page: 1, pageSize: 1_000_000 }

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  cancelled: 'Storniert',
  draft: 'Entwurf',
  issued: 'Gestellt',
  paid: 'Bezahlt',
  overdue: 'Überfällig'
}

const text = (value: string | null | undefined): string | null => value?.trim() || null

/** "2026-06-11" → a date cell; anything else stays text */
function dateCell(value: string | null | undefined): Cell {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : text(value)
}

const ADDRESS_COLUMNS: Column[] = [
  { header: 'Straße' },
  { header: 'Hausnummer' },
  { header: 'PLZ' },
  { header: 'Ort' },
  { header: 'Bundesland' },
  { header: 'Land' }
]

function addressCells(address: AddressDto | null): Cell[] {
  return [
    text(address?.street),
    text(address?.streetNumber),
    text(address?.zipCode),
    text(address?.city),
    text(address?.state),
    text(address?.country)
  ]
}

const CONTACT_COLUMNS: Column[] = [
  { header: 'E-Mail' },
  { header: 'Telefon' },
  { header: 'Mobil' },
  { header: 'Website' }
]

function contactCells(contact: ContactDto | null): Cell[] {
  return [
    text(contact?.email),
    text(contact?.phone),
    text(contact?.mobilePhone),
    text(contact?.homepage)
  ]
}

@injectable()
export class ExportService {
  constructor(
    @inject(BandService) private bands: BandService,
    @inject(BankService) private banks: BankService,
    @inject(CompanyService) private companies: CompanyService,
    @inject(DealMemoService) private events: DealMemoService,
    @inject(HotelService) private hotels: HotelService,
    @inject(InvoiceService) private invoices: InvoiceService,
    @inject(PersonService) private persons: PersonService,
    @inject(VenueService) private venues: VenueService
  ) {}

  /** One list with the grid's search/filter, every page */
  async table(input: ExportListInput): Promise<ListTable> {
    const query = {
      ...ALL,
      search: input.search || undefined,
      sortBy: input.sortBy,
      sortDir: input.sortDir
    }
    const name = EXPORT_LIST_LABELS[input.list]

    switch (input.list) {
      case 'bands': {
        const result = await this.bands.getAllBandsPaginated(query)
        const companyNames = await this.companyNames()
        const personNames = await this.personNames()
        return {
          name,
          columns: [
            { header: 'Band' },
            { header: 'Genre' },
            { header: 'Gründung' },
            { header: 'Firma' },
            { header: 'Management' },
            { header: 'Technischer Leiter' },
            { header: 'Anmerkungen' }
          ],
          rows: BandMapper.toDtoList(result.items).map((band) => [
            band.name,
            text(band.genre),
            text(band.founded),
            companyNames.get(band.companyId) ?? null,
            band.managementCompanyId ? (companyNames.get(band.managementCompanyId) ?? null) : null,
            band.responsiblePersonId ? (personNames.get(band.responsiblePersonId) ?? null) : null,
            text(band.notes)
          ])
        }
      }
      case 'persons': {
        const result = await this.persons.getAllPersonsPaginated(query)
        return {
          name,
          columns: [
            { header: 'Vorname' },
            { header: 'Nachname' },
            { header: 'Geburtstag', kind: 'date' },
            ...CONTACT_COLUMNS,
            ...ADDRESS_COLUMNS,
            { header: 'Anmerkungen' }
          ],
          rows: PersonMapper.toDtoList(result.items).map((person) => [
            person.firstName,
            text(person.lastName),
            dateCell(person.birthday),
            ...contactCells(person.contact),
            ...addressCells(person.address),
            text(person.notes)
          ])
        }
      }
      case 'companies': {
        const result = await this.companies.getAllCompaniesPaginated(query)
        return {
          name,
          columns: [
            { header: 'Firma' },
            { header: 'USt-IdNr.' },
            { header: 'Steuernummer' },
            ...CONTACT_COLUMNS,
            ...ADDRESS_COLUMNS,
            { header: 'Bank' },
            { header: 'IBAN' },
            { header: 'Anmerkungen' }
          ],
          rows: CompanyMapper.toDtoList(result.items).map((company) => [
            company.name,
            text(company.vatNumber),
            text(company.taxNumber),
            ...contactCells(company.contact),
            ...addressCells(company.address),
            text(company.bank?.bankName),
            text(company.bank?.iban),
            text(company.notes)
          ])
        }
      }
      case 'venues': {
        const result = await this.venues.getAllVenuesPaginated({ ...query, kind: input.kind })
        return {
          name,
          columns: [
            { header: 'Spielstätte' },
            { header: 'Art' },
            { header: 'Kapazität', kind: 'number' },
            { header: 'Genres' },
            { header: 'Veranstalter' },
            ...CONTACT_COLUMNS,
            ...ADDRESS_COLUMNS,
            { header: 'Anmerkungen' }
          ],
          rows: VenueMapper.toDtoList(result.items).map((venue) => [
            venue.name,
            VENUE_KIND_LABELS[venue.kind],
            venue.capacity,
            text(venue.genres),
            text(venue.company?.name),
            ...contactCells(venue.contact),
            ...addressCells(venue.address),
            text(venue.notes)
          ])
        }
      }
      case 'hotels': {
        const result = await this.hotels.getAllHotelsPaginated(query)
        return {
          name,
          columns: [
            { header: 'Hotel' },
            ...CONTACT_COLUMNS,
            ...ADDRESS_COLUMNS,
            { header: 'Anmerkungen' }
          ],
          rows: HotelMapper.toDtoList(result.items).map((hotel) => [
            hotel.name,
            ...contactCells(hotel.contact),
            ...addressCells(hotel.address),
            text(hotel.notes)
          ])
        }
      }
      case 'events': {
        const result = await this.events.getAllDealMemosPaginated(query)
        return {
          name,
          columns: [
            { header: 'Datum', kind: 'date' },
            { header: 'Event' },
            { header: 'Band' },
            { header: 'Spielstätte' },
            { header: 'Status' },
            { header: 'Deal' }
          ],
          rows: DealMemoMapper.toListItemDtoList(result.items).map((event) => [
            dateCell(event.date),
            event.name,
            event.bandName,
            text(event.venueName),
            STATUS_LABELS[event.status] ?? text(event.status),
            text(event.deal)
          ])
        }
      }
      case 'invoices': {
        const result = await this.invoices.getAllInvoicesPaginated(query)
        return {
          name,
          columns: [
            { header: 'Rechnungsnr.', kind: 'number' },
            { header: 'Rechnungsdatum', kind: 'date' },
            { header: 'Fällig', kind: 'date' },
            { header: 'Rechnungssteller' },
            { header: 'Empfänger' },
            { header: 'Event' },
            { header: 'Zeitraum' },
            { header: 'Status' },
            { header: 'Netto', kind: 'money' },
            { header: 'USt.', kind: 'money' },
            { header: 'Brutto', kind: 'money' },
            { header: 'Währung' }
          ],
          rows: InvoiceMapper.toListItemDtoList(result.items).map((invoice) => [
            invoice.invoiceNumber,
            dateCell(invoice.issueDate),
            dateCell(invoice.dueDate),
            invoice.companyName,
            invoice.recipientName,
            text(invoice.dealMemoName),
            text(invoice.periodLabel),
            invoice.kind === 'cancellation'
              ? `Storno zu ${invoice.cancelsInvoiceNumber ?? '?'}`
              : (STATUS_LABELS[invoice.status] ?? invoice.status),
            invoice.subtotalNetAmount,
            invoice.subtotalTaxAmount,
            invoice.totalGrossAmount,
            invoice.currency
          ])
        }
      }
      case 'banks': {
        const result = await this.banks.getAllBanksPaginated(query)
        return {
          name,
          columns: [
            { header: 'Bank' },
            { header: 'Kontoinhaber' },
            { header: 'IBAN' },
            { header: 'BIC' }
          ],
          rows: BankMapper.toDtoList(result.items).map((bank) => [
            bank.bankName,
            bank.accountHolder,
            bank.iban,
            text(bank.bic)
          ])
        }
      }
    }
  }

  private async companyNames(): Promise<Map<number, string>> {
    const all = await this.companies.getAllCompanies()
    return new Map(all.map((company) => [company.id, company.name]))
  }

  private async personNames(): Promise<Map<number, string>> {
    const all = await this.persons.getAllPersons()
    return new Map(
      all.map((person) => [person.id, `${person.first_name} ${person.last_name}`.trim()])
    )
  }

  /**
   * The table as CSV for Excel in `locale`'s regional format: its separator,
   * dates as Excel shows them there, numbers with its decimal mark
   */
  csv(table: ListTable, locale: string): string {
    const date = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    })
    const number = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 6 })
    const money = new Intl.NumberFormat(locale, {
      useGrouping: false,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
    const cell = (value: Cell, kind: ColumnKind | undefined): string => {
      if (value === null) return ''
      if (value instanceof Date) return date.format(value)
      if (typeof value === 'number') return (kind === 'money' ? money : number).format(value)
      return value
    }
    const rows = [
      table.columns.map((column) => column.header),
      ...table.rows.map((row) => row.map((value, index) => cell(value, table.columns[index].kind)))
    ]
    return CSV_BOM + toCsv(rows, csvSeparator(locale))
  }

  /** All lists, unfiltered */
  async allTables(): Promise<ListTable[]> {
    const tables: ListTable[] = []
    for (const list of ExportList.options) tables.push(await this.table({ list }))
    return tables
  }
}
