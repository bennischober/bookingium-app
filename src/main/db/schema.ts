import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  check,
  type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { DOCUMENT_OWNER_TYPES } from '../api/schemas/document.schema'
import { CompanyKind } from '../api/schemas/company.schema'
import { VenueKind } from '../api/schemas/venue.schema'
import { ExternalBookingKind, ExternalBookingStatus } from '../api/schemas/external_booking.schema'
import { DealMemoStatus } from '../api/schemas/deal_memo.schema'
import {
  InvoiceEmailKind,
  InvoiceKind,
  InvoiceNumberFormat,
  InvoiceRecipientKind,
  InvoiceStatus,
  InvoiceTaxCode
} from '../api/schemas/invoice.schema'
import { DocumentEmailKind, DocumentEmailLang } from '../api/schemas/mailTemplate.schema'
import { DatevCategory, DatevTransferStatus } from '../api/schemas/datev.schema'
// Sync (src/main/sync): ids from this computer's range while sync is on, SQLite's otherwise
import { nextRowId } from '../sync/ids'

/**
 * #151: a CHECK that a text column holds one of a zod enum's values, so the database and
 * the router accept the same set. NULL passes (SQLite CHECKs only reject false). The column
 * is named bare on purpose: drizzle-kit rebuilds a table as `__new_<table>`, and a
 * table-qualified name would not resolve there.
 */
function oneOf(name: string, column: string, values: readonly string[]) {
  return check(name, sql.raw(`"${column}" IN (${values.map((v) => `'${v}'`).join(', ')})`))
}

/** #151: at most one of the record columns is set (follow_up, appointment) */
function atMostOne(name: string, columns: readonly string[]) {
  return check(name, sql.raw(`${columns.map((c) => `("${c}" IS NOT NULL)`).join(' + ')} <= 1`))
}

// ========================================
// Normalized Reference Tables
// ========================================

// Address table (singular form following SQL best practices)
export const address = sqliteTable(
  'address',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    street: text('street').default('').notNull(),
    street_number: text('street_number').default('').notNull(),
    address_suffix: text('address_suffix').default(''),
    zip_code: text('zip_code').default('').notNull(),
    city: text('city').default('').notNull(),
    state: text('state').default('').notNull(),
    country: text('country').default('').notNull(),
    country_code: text('country_code', { length: 2 }).default('').notNull() // ISO 3166-1 alpha-2
  },
  (table) => [
    index('address_city_idx').on(table.city),
    index('address_country_idx').on(table.country)
  ]
)

// Contact table
export const contact = sqliteTable(
  'contact',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    email: text('email').default('').notNull(),
    phone: text('phone'),
    mobile_phone: text('mobile_phone'),
    homepage: text('homepage'),
    // Werbewiderspruch: never put this address on a mailing list (§ 7 UWG)
    no_advertising: integer('no_advertising', { mode: 'boolean' }).default(false).notNull()
  },
  (table) => [index('contact_email_idx').on(table.email)]
)

// A contact's further email addresses. contact.email stays the primary one
// (invoices, mailing lists, forms); these only link mail to the contact's record.
export const contact_email = sqliteTable(
  'contact_email',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    contact_id: integer('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    // Lower-cased and trimmed on write
    email: text('email').notNull(),
    // Order in the form
    position: integer('position').default(0).notNull()
  },
  (table) => [
    index('contact_email_email_idx').on(table.email),
    uniqueIndex('contact_email_contact_email_idx').on(table.contact_id, table.email)
  ]
)

// Bank table
export const bank = sqliteTable(
  'bank',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    bank_name: text('bank_name').default('').notNull(),
    account_holder: text('account_holder').default('').notNull(),
    iban: text('iban', { length: 34 }).default('').notNull(), // Max IBAN length
    bic: text('bic', { length: 11 }).default('').notNull() // BIC is 8 or 11 chars
  },
  (table) => [index('bank_iban_idx').on(table.iban)]
)

// ========================================
// Main Tables
// ========================================

// Person table
export const person = sqliteTable(
  'person',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    first_name: text('first_name').notNull(),
    last_name: text('last_name').notNull(),
    birthday: text('birthday'), // ISO 8601 format: YYYY-MM-DD
    notes: text('notes'),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    // Kundennummer, given on the first issued invoice to this customer (or entered, e.g. from
    // DATEV); one number space across companies, bands and persons
    customer_number: integer('customer_number'),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('person_name_idx').on(table.first_name, table.last_name),
    uniqueIndex('person_customer_number_idx').on(table.customer_number)
  ]
)

// Company table
export const company = sqliteTable(
  'company',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    name: text('name').notNull(),
    // 'company' or 'media' (radio stations and the like, a Verteiler source, #80)
    kind: text('kind').default('company').notNull(),
    notes: text('notes'),
    bank_id: integer('bank_id').references(() => bank.id, { onDelete: 'set null' }),
    vat_id: text('vat_id').default('').notNull(), // USt-IdNr. with country prefix (#153)
    tax_number: text('tax_number').default('').notNull(),
    commercial_register_no: text('commercial_register_no').default('').notNull(),
    register_court: text('register_court').default('').notNull(),
    logo_path: text('logo_path').default('').notNull(),
    signature_path: text('signature_path').default('').notNull(),
    ksk_number: text('ksk_number').default('').notNull(),
    // Kundennummer, given on the first issued invoice to this customer (or entered, e.g. from
    // DATEV); one number space across companies, bands and persons
    customer_number: integer('customer_number'),
    is_default_for_invoicing: integer('is_default_for_invoicing', { mode: 'boolean' })
      .default(false)
      .notNull(),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    // Contact person printed into e-invoices (seller contact, BG-6)
    invoice_contact_person_id: integer('invoice_contact_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('company_name_idx').on(table.name),
    uniqueIndex('company_customer_number_idx').on(table.customer_number),
    // One company issues invoices by default
    uniqueIndex('company_default_for_invoicing_idx')
      .on(table.is_default_for_invoicing)
      .where(sql.raw('"is_default_for_invoicing" = 1')),
    oneOf('company_kind_check', 'kind', CompanyKind.options)
  ]
)

// Company member junction table
export const company_member = sqliteTable(
  'company_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    company_id: integer('company_id')
      .notNull()
      .references(() => company.id, { onDelete: 'cascade' }),
    person_id: integer('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    role: text('role'),
    notes: text('notes')
  },
  (table) => [
    index('company_member_company_idx').on(table.company_id),
    index('company_member_person_idx').on(table.person_id),
    uniqueIndex('company_member_unique_idx').on(table.company_id, table.person_id)
  ]
)

// Band table
export const band = sqliteTable(
  'band',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    name: text('name').notNull(),
    founded: text('founded'), // ISO 8601 format: YYYY-MM-DD
    notes: text('notes').default('').notNull(),
    // Kundennummer, given on the first issued invoice to this customer (or entered, e.g. from
    // DATEV); one number space across companies, bands and persons
    customer_number: integer('customer_number'),
    company_id: integer('company_id')
      .notNull()
      .references(() => company.id),
    // Technischer Leiter (TL) - technical director, contract contact person
    responsible_person_id: integer('responsible_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),
    // Management company that represents the band in contracts ("vertreten
    // durch"); events can override it
    management_company_id: integer('management_company_id').references(() => company.id, {
      onDelete: 'set null'
    }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('band_name_idx').on(table.name),
    index('band_company_idx').on(table.company_id),
    uniqueIndex('band_customer_number_idx').on(table.customer_number)
  ]
)

// Band member junction table
export const band_member = sqliteTable(
  'band_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    band_id: integer('band_id')
      .notNull()
      .references(() => band.id, { onDelete: 'cascade' }),
    person_id: integer('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    role: text('role'),
    notes: text('notes')
  },
  (table) => [
    index('band_member_band_idx').on(table.band_id),
    index('band_member_person_idx').on(table.person_id),
    uniqueIndex('band_member_unique_idx').on(table.band_id, table.person_id)
  ]
)

// Venue table
export const venue = sqliteTable(
  'venue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    name: text('name').notNull(),
    // 'venue' (club, hall, theatre, ...) or 'festival'
    kind: text('kind').default('venue').notNull(),
    capacity: integer('capacity'),
    notes: text('notes').default('').notNull(),
    // Radius clause (Gebietsschutz) this venue usually demands, #102: km around it and weeks
    // before/after the show. Null = the global default for the kind (Einstellungen).
    radius_km: integer('radius_km'),
    radius_weeks_before: integer('radius_weeks_before'),
    radius_weeks_after: integer('radius_weeks_after'),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    // owner, but not required
    company_id: integer('company_id').references(() => company.id, { onDelete: 'set null' }),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('venue_name_idx').on(table.name),
    index('venue_company_idx').on(table.company_id),
    oneOf('venue_kind_check', 'kind', VenueKind.options)
  ]
)

// Venue member junction table
export const venue_member = sqliteTable(
  'venue_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    venue_id: integer('venue_id')
      .notNull()
      .references(() => venue.id, { onDelete: 'cascade' }),
    person_id: integer('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    role: text('role'),
    notes: text('notes')
  },
  (table) => [
    index('venue_member_venue_idx').on(table.venue_id),
    index('venue_member_person_idx').on(table.person_id),
    uniqueIndex('venue_member_unique_idx').on(table.venue_id, table.person_id)
  ]
)

// #152: genre tags of venues, media companies and bands (the Verteiler's genre filter).
// A name exists once, whatever its case; a genre no record uses any more is deleted
// (repositories/genres.ts), so this is the list of known genres the forms suggest.
export const genre = sqliteTable(
  'genre',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    name: text('name').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  // NOCASE folds ASCII only; the repository also matches names with toLocaleLowerCase
  (table) => [uniqueIndex('genre_name_idx').on(sql`${table.name} COLLATE NOCASE`)]
)

// One row per tag of a record; position keeps the order the tags were entered in
export const venue_genre = sqliteTable(
  'venue_genre',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    venue_id: integer('venue_id')
      .notNull()
      .references(() => venue.id, { onDelete: 'cascade' }),
    genre_id: integer('genre_id')
      .notNull()
      .references(() => genre.id, { onDelete: 'cascade' }),
    position: integer('position').default(0).notNull()
  },
  (table) => [
    uniqueIndex('venue_genre_unique_idx').on(table.venue_id, table.genre_id),
    index('venue_genre_genre_idx').on(table.genre_id)
  ]
)

export const company_genre = sqliteTable(
  'company_genre',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    company_id: integer('company_id')
      .notNull()
      .references(() => company.id, { onDelete: 'cascade' }),
    genre_id: integer('genre_id')
      .notNull()
      .references(() => genre.id, { onDelete: 'cascade' }),
    position: integer('position').default(0).notNull()
  },
  (table) => [
    uniqueIndex('company_genre_unique_idx').on(table.company_id, table.genre_id),
    index('company_genre_genre_idx').on(table.genre_id)
  ]
)

export const band_genre = sqliteTable(
  'band_genre',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    band_id: integer('band_id')
      .notNull()
      .references(() => band.id, { onDelete: 'cascade' }),
    genre_id: integer('genre_id')
      .notNull()
      .references(() => genre.id, { onDelete: 'cascade' }),
    position: integer('position').default(0).notNull()
  },
  (table) => [
    uniqueIndex('band_genre_unique_idx').on(table.band_id, table.genre_id),
    index('band_genre_genre_idx').on(table.genre_id)
  ]
)

// Hotel table
export const hotel = sqliteTable(
  'hotel',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    name: text('name').notNull(),
    notes: text('notes'),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [index('hotel_name_idx').on(table.name)]
)

// Deal memo table
export const deal_memo = sqliteTable(
  'deal_memo',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    name: text('name').notNull(),
    deal: text('deal').notNull().default(''), // financial deal terms, e.g. "70/30"
    date: text('date').notNull(), // ISO 8601 format: YYYY-MM-DD
    ticket_price_vvk_cents: integer('ticket_price_vvk_cents'),
    ticket_price_ak_cents: integer('ticket_price_ak_cents'),
    posters: text('posters').default('').notNull(),
    status: text('status').default('pending').notNull(),
    notes: text('notes').default('').notNull(),
    amount_of_people: integer('amount_of_people').default(0),
    room_information: text('room_information').default(''),
    performance_duration: text('performance_duration').default(''),
    performance_time: text('performance_time').default(''),
    performance_information: text('performance_information').default(''),
    guarantee_cents: integer('guarantee_cents'),
    guarantee_vat_rate: real('guarantee_vat_rate'),
    contract_notes: text('contract_notes').default(''),
    // Radius clause of this contract, #102; null = the venue's, then the global default
    radius_km: integer('radius_km'),
    radius_weeks_before: integer('radius_weeks_before'),
    radius_weeks_after: integer('radius_weeks_after'),
    lopro_person_id: integer('lopro_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),
    lopro_company_id: integer('lopro_company_id').references(() => company.id, {
      onDelete: 'set null'
    }),
    invoice_company_id: integer('invoice_company_id').references(() => company.id, {
      onDelete: 'set null'
    }),
    // Contract "vertreten durch" (the management/agency acting for the band)
    // for this event only; null = the band's management company, then the
    // default own company
    representing_company_id: integer('representing_company_id').references(() => company.id, {
      onDelete: 'set null'
    }),
    band_id: integer('band_id')
      .notNull()
      .references(() => band.id),
    venue_id: integer('venue_id').references(() => venue.id, { onDelete: 'set null' }),
    hotel_id: integer('hotel_id').references(() => hotel.id, { onDelete: 'set null' }),
    /**
     * D3: an archived event is out of every working view but still there - its itinerary,
     * follow-ups, documents, mails and the link from its invoices all survive. Null means
     * active. A timestamp rather than a boolean, so "when" stays answerable.
     */
    archived_at: text('archived_at'),
    // The tour the event belongs to ("Frühjahr 2027"), '' for none; the map and the event list
    // filter by it, the tour import sets it
    tour: text('tour').default('').notNull(),
    // #201: when the contract went out (set when bookingum sent its mail, or by hand) and when
    // it came back signed; a contract sent but not back is an open point
    contract_sent_at: text('contract_sent_at'), // YYYY-MM-DD
    contract_returned_at: text('contract_returned_at'), // YYYY-MM-DD
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('deal_memo_name_idx').on(table.name),
    index('deal_memo_date_idx').on(table.date),
    index('deal_memo_band_idx').on(table.band_id),
    index('deal_memo_venue_idx').on(table.venue_id),
    index('deal_memo_invoice_company_idx').on(table.invoice_company_id),
    index('deal_memo_status_idx').on(table.status),
    index('deal_memo_archived_idx').on(table.archived_at),
    index('deal_memo_tour_idx').on(table.tour),
    oneOf('deal_memo_status_check', 'status', DealMemoStatus.options)
  ]
)

// Optional prepayments on the fee (net, in cents like deal_memo.guarantee_cents):
// the contract's "Vorkasse" clause, printed only when a deal memo has rows here.
// Ordered by position; a null due date means "bei Vertragsabschluss"
export const deal_memo_deposit = sqliteTable(
  'deal_memo_deposit',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    deal_memo_id: integer('deal_memo_id')
      .notNull()
      .references(() => deal_memo.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    amount_cents: integer('amount_cents').default(0).notNull(),
    due_date: text('due_date'), // ISO 8601 date
    // #201: when it was paid, null = open; an open one past its due date is an open point
    paid_at: text('paid_at') // YYYY-MM-DD
  },
  (table) => [index('deal_memo_deposit_deal_memo_idx').on(table.deal_memo_id, table.position)]
)

// Per-company invoice numbering settings
export const company_invoice_settings = sqliteTable(
  'company_invoice_settings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    company_id: integer('company_id')
      .notNull()
      .references(() => company.id, { onDelete: 'cascade' }),
    // The next running number (with format `year`, the part after the year)
    next_invoice_number: integer('next_invoice_number').default(1).notNull(),
    // plain | year (InvoiceNumberFormat): 1040 or 2026813
    invoice_number_format: text('invoice_number_format').default('plain').notNull(),
    // Format `year`: the running number is padded to this many digits (2026 + 813)
    invoice_number_digits: integer('invoice_number_digits').default(3).notNull(),
    // Format `year`: the running number starts at 1 again in a new year
    invoice_number_yearly_reset: integer('invoice_number_yearly_reset', { mode: 'boolean' })
      .default(false)
      .notNull(),
    // The issue year of the last number taken (for the yearly restart)
    invoice_number_year: integer('invoice_number_year'),
    // The "DATEV Upload Mail" addresses of the company's DATEV client (Mandant), one per document
    // category, '' for none. datev_upload_email is Rechnungsausgang, where invoices go by default
    datev_upload_email: text('datev_upload_email').default('').notNull(),
    datev_upload_email_incoming: text('datev_upload_email_incoming').default('').notNull(),
    datev_upload_email_cash: text('datev_upload_email_cash').default('').notNull(),
    datev_upload_email_other: text('datev_upload_email_other').default('').notNull(),
    datev_upload_email_credit_card: text('datev_upload_email_credit_card').default('').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    uniqueIndex('company_invoice_settings_company_unique_idx').on(table.company_id),
    index('company_invoice_settings_next_number_idx').on(table.next_invoice_number),
    oneOf(
      'company_invoice_settings_number_format_check',
      'invoice_number_format',
      InvoiceNumberFormat.options
    ),
    check(
      'company_invoice_settings_number_digits_check',
      sql.raw('"invoice_number_digits" BETWEEN 1 AND 9')
    )
  ]
)

// Immutable invoice party snapshots (issuer/recipient data at invoice issue time)
export const invoice_party_snapshot = sqliteTable(
  'invoice_party_snapshot',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    kind: text('kind').notNull(), // company | band | person | other
    source_company_id: integer('source_company_id').references(() => company.id, {
      onDelete: 'set null'
    }),
    source_band_id: integer('source_band_id').references(() => band.id, { onDelete: 'set null' }),
    source_person_id: integer('source_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),
    legal_name: text('legal_name').notNull(),
    // The recipient's Kundennummer as it was when the invoice was issued
    customer_number: integer('customer_number'),
    street: text('street').default('').notNull(),
    street_number: text('street_number').default('').notNull(),
    zip_code: text('zip_code').default('').notNull(),
    city: text('city').default('').notNull(),
    country: text('country').default('').notNull(),
    country_code: text('country_code', { length: 2 }).default('').notNull(),
    vat_id: text('vat_id').default('').notNull(), // USt-IdNr. with country prefix (#153)
    tax_number: text('tax_number').default('').notNull(),
    commercial_register_no: text('commercial_register_no').default('').notNull(),
    register_court: text('register_court').default('').notNull(),
    website: text('website').default('').notNull(),
    account_holder: text('account_holder').default('').notNull(),
    bank_name: text('bank_name').default('').notNull(),
    logo_path: text('logo_path').default('').notNull(),
    email: text('email').default('').notNull(),
    phone: text('phone').default('').notNull(),
    iban: text('iban').default('').notNull(),
    bic: text('bic').default('').notNull(),
    // Contact person (company's invoice contact; e-invoice seller contact)
    contact_name: text('contact_name').default('').notNull(),
    contact_phone: text('contact_phone').default('').notNull(),
    contact_email: text('contact_email').default('').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('invoice_party_snapshot_kind_idx').on(table.kind),
    index('invoice_party_snapshot_legal_name_idx').on(table.legal_name),
    oneOf('invoice_party_snapshot_kind_check', 'kind', InvoiceRecipientKind.options)
  ]
)

// Invoice table
export const invoice = sqliteTable(
  'invoice',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    // Assigned from the company's counter when the invoice is issued; drafts
    // have none, so deleting a draft never leaves a gap in the sequence
    invoice_number: integer('invoice_number'),
    company_id: integer('company_id')
      .notNull()
      .references(() => company.id),
    issuer_snapshot_id: integer('issuer_snapshot_id').references(() => invoice_party_snapshot.id, {
      onDelete: 'set null'
    }),
    recipient_snapshot_id: integer('recipient_snapshot_id').references(
      () => invoice_party_snapshot.id,
      { onDelete: 'set null' }
    ),
    deal_memo_id: integer('deal_memo_id').references(() => deal_memo.id, { onDelete: 'set null' }),
    period_start_date: text('period_start_date'),
    period_end_date: text('period_end_date'),
    period_label: text('period_label').default('').notNull(),
    issue_date: text('issue_date')
      .default(sql`(date('now'))`)
      .notNull(),
    due_date: text('due_date'),
    status: text('status').default('draft').notNull(),
    currency: text('currency').default('EUR').notNull(),
    subtotal_net_cents: integer('subtotal_net_cents').default(0).notNull(),
    subtotal_tax_cents: integer('subtotal_tax_cents').default(0).notNull(),
    total_gross_cents: integer('total_gross_cents').default(0).notNull(),
    payment_terms: text('payment_terms').default('').notNull(),
    // Tax note printed on the invoice; also the e-invoice exemption reason
    // (BT-120) for reverse charge, exempt and other zero-VAT lines
    reverse_charge_note: text('reverse_charge_note').default('').notNull(),
    // Buyer reference / Leitweg-ID (e-invoice BT-10), optional
    buyer_reference: text('buyer_reference').default('').notNull(),
    // E-invoice as XRechnung (public-sector buyers) instead of plain EN 16931
    xrechnung: integer('xrechnung', { mode: 'boolean' }).default(false).notNull(),
    // invoice | cancellation (Stornorechnung: negative copy of the invoice
    // it cancels, own number, e-invoice type 381)
    kind: text('kind').default('invoice').notNull(),
    cancels_invoice_id: integer('cancels_invoice_id').references(
      (): AnySQLiteColumn => invoice.id,
      { onDelete: 'set null' }
    ),
    notes: text('notes').default('').notNull(),
    // Latest of the invoice's emails (all of them in invoice_email), for the
    // list: when "Per E-Mail senden" created it (datetime, UTC), to whom
    emailed_at: text('emailed_at'),
    emailed_to: text('emailed_to').default('').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('invoice_company_idx').on(table.company_id),
    index('invoice_recipient_snapshot_idx').on(table.recipient_snapshot_id),
    index('invoice_deal_memo_idx').on(table.deal_memo_id),
    index('invoice_status_idx').on(table.status),
    index('invoice_issue_date_idx').on(table.issue_date),
    index('invoice_period_start_idx').on(table.period_start_date),
    index('invoice_cancels_invoice_idx').on(table.cancels_invoice_id),
    uniqueIndex('invoice_company_invoice_number_unique_idx').on(
      table.company_id,
      table.invoice_number
    ),
    oneOf('invoice_status_check', 'status', InvoiceStatus.options),
    oneOf('invoice_kind_check', 'kind', InvoiceKind.options)
  ]
)

// Invoice line items with tax-aware totals
export const invoice_line_item = sqliteTable(
  'invoice_line_item',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    position: integer('position').default(1).notNull(),
    description: text('description').notNull(),
    quantity: real('quantity').default(1).notNull(),
    unit: text('unit').default('service').notNull(),
    unit_price_net: real('unit_price_net').default(0).notNull(),
    tax_rate: real('tax_rate').default(0).notNull(),
    tax_code: text('tax_code').default('standard').notNull(),
    line_net_cents: integer('line_net_cents').default(0).notNull(),
    line_tax_cents: integer('line_tax_cents').default(0).notNull(),
    line_gross_cents: integer('line_gross_cents').default(0).notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('invoice_line_item_invoice_idx').on(table.invoice_id),
    index('invoice_line_item_position_idx').on(table.invoice_id, table.position),
    check('invoice_line_item_position_check', sql.raw('"position" >= 1')),
    oneOf('invoice_line_item_tax_code_check', 'tax_code', InvoiceTaxCode.options)
  ]
)

// Each email "Per E-Mail senden" created for an invoice (the app never sends
// it itself): the invoice, or a payment reminder about it
export const invoice_email = sqliteTable(
  'invoice_email',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    // invoice | reminder (Zahlungserinnerung) | dunning (Mahnung)
    kind: text('kind').default('invoice').notNull(),
    // Prefilled recipient address, '' when the recipient had none
    to: text('to').default('').notNull(),
    // C1: the sent mail's Message-ID, set only when bookingum sent it itself -
    // the external programs cannot report a send, so it stays null there
    message_id: text('message_id'),
    // C1: the mail account it was sent from (C4 uses it)
    mail_account_id: text('mail_account_id'),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('invoice_email_invoice_idx').on(table.invoice_id),
    oneOf('invoice_email_kind_check', 'kind', InvoiceEmailKind.options)
  ]
)

/**
 * A document handed to DATEV Unternehmen online by DATEV Upload Mail: written as `pending`
 * before the send and set to `sent` when the send is confirmed - right away, or later, when an
 * unclear send is found in Sent. A send refused before the server took it deletes the row.
 */
export const datev_transfer = sqliteTable(
  'datev_transfer',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    status: text('status').default('pending').notNull(),
    // The document category, by the upload address it was mailed to
    category: text('category').default('outgoing').notNull(),
    // The upload address it was mailed to
    to: text('to').notNull(),
    // The attachment's file name, as DATEV shows it
    file_name: text('file_name').notNull(),
    mail_account_id: text('mail_account_id').notNull(),
    // The send key; the mail core makes it the local part of the Message-ID
    send_key: text('send_key').notNull(),
    message_id: text('message_id'),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    sent_at: text('sent_at')
  },
  (table) => [
    index('datev_transfer_invoice_idx').on(table.invoice_id),
    uniqueIndex('datev_transfer_send_key_idx').on(table.send_key),
    oneOf('datev_transfer_status_check', 'status', DatevTransferStatus.options),
    oneOf('datev_transfer_category_check', 'category', DatevCategory.options)
  ]
)

/**
 * I7: an invoice mail bookingum is sending. The row is written before the send and turned
 * into an invoice_email when the send is confirmed - right away, or later, when an unclear
 * send is found in Sent after the editor was closed or the app restarted.
 */
export const invoice_email_pending = sqliteTable(
  'invoice_email_pending',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    kind: text('kind').default('invoice').notNull(),
    to: text('to').default('').notNull(),
    mail_account_id: text('mail_account_id').notNull(),
    // The editor's send key; the core makes it the local part of the Message-ID
    send_key: text('send_key').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    uniqueIndex('invoice_email_pending_send_key_idx').on(table.send_key),
    oneOf('invoice_email_pending_kind_check', 'kind', InvoiceEmailKind.options)
  ]
)

// Each status an invoice moved to (issued, paid, overdue, back to issued,
// cancelled), for its Verlauf
export const invoice_status_change = sqliteTable(
  'invoice_status_change',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    // datetime (UTC); a plain date for the ones carried over by the migration
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('invoice_status_change_invoice_idx').on(table.invoice_id),
    oneOf('invoice_status_change_status_check', 'status', InvoiceStatus.options)
  ]
)

export const itinerary = sqliteTable(
  'itinerary',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    notes: text('notes').default('').notNull(),
    deal_memo_id: integer('deal_memo_id')
      .notNull()
      .references(() => deal_memo.id, { onDelete: 'cascade' }),
    get_in: text('get_in').default('').notNull(), // Time format: HH:MM
    load_in: text('load_in').default('').notNull(),
    sound_check_main_act: text('sound_check_main_act').default('').notNull(),
    sound_check_support: text('sound_check_support').default('').notNull(),
    dinner: text('dinner').default('').notNull(),
    doors: text('doors').default('').notNull(),
    show_time_main_act: text('show_time_main_act').default('').notNull(),
    show_time_support: text('show_time_support').default('').notNull(),
    curfew_stage: text('curfew_stage').default('').notNull(),
    curfew_venue: text('curfew_venue').default('').notNull(),
    show_length: text('show_length').default('').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    uniqueIndex('itinerary_deal_memo_idx').on(table.deal_memo_id) // One itinerary per deal memo
  ]
)

// Document owners: the record a file belongs to (DOCUMENT_OWNER_TYPES, 'event' =
// deal memo). Kept generic (type + id instead of one foreign key per owner)
// so more owners need no table change; triggers in migration 0009 delete the
// rows when the owner is deleted.

// Document table - metadata of files stored under storage/documents/
export const document = sqliteTable(
  'document',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    owner_type: text('owner_type', { enum: DOCUMENT_OWNER_TYPES }).notNull(),
    owner_id: integer('owner_id').notNull(),
    file_name: text('file_name').notNull(),
    // User-chosen name shown in the lists; null = the file name on disk. The file
    // itself is never renamed, so the folder stays as it was and a rename cannot
    // fail on a locked file.
    display_name: text('display_name'),
    file_type: text('file_type').notNull(),
    // Relative to the storage folder, e.g. documents/bands/3-pretty-wild/rider.pdf
    file_path: text('file_path').notNull(),
    document_type: text('document_type').notNull().default('other'),
    file_size: integer('file_size').notNull(),
    uploaded_at: text('uploaded_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    uploaded_by: text('uploaded_by'),
    // C5: set when the file came from a mail attachment; null for an upload
    source_message_id: text('source_message_id'),
    source_mail_account_id: text('source_mail_account_id'),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('document_owner_idx').on(table.owner_type, table.owner_id),
    index('document_type_idx').on(table.document_type),
    index('document_uploaded_at_idx').on(table.uploaded_at)
  ]
)

// Links between a mail and a record of this app (C2). The mail store stays
// rebuildable, so the link names the mail by its Message-ID (or a fallback hash) and
// the account - never the store's row id or message_key. No FK to the entity: like
// document, the owner is a type plus an id, and a delete trigger removes its links.
export const MAIL_LINK_ENTITY_TYPES = [
  'person',
  'company',
  'band',
  'venue',
  'event',
  'invoice',
  'contract'
] as const
export type MailLinkEntityType = (typeof MAIL_LINK_ENTITY_TYPES)[number]
export const MAIL_LINK_SOURCES = ['address', 'thread', 'sent', 'manual', 'rule'] as const
export type MailLinkSource = (typeof MAIL_LINK_SOURCES)[number]

export const mail_link = sqliteTable(
  'mail_link',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    mail_account_id: text('mail_account_id').notNull(),
    // Without the angle brackets, as in the mail store's message_id
    message_id: text('message_id'),
    // sha1(date|from_email|size_bytes|subject) for a mail without a Message-ID
    fallback_key: text('fallback_key'),
    entity_type: text('entity_type', { enum: MAIL_LINK_ENTITY_TYPES }).notNull(),
    entity_id: integer('entity_id').notNull(),
    source: text('source', { enum: MAIL_LINK_SOURCES }).notNull(),
    // The mail's own date, stored when the link is made so the tab can sort by
    // it - the link's created_at says when the user linked it, not when the mail
    // was sent (a March mail linked by hand today must not sort above yesterday's)
    mail_date: text('mail_date'),
    // 1 = the user removed an automatic link; the linker never adds it again
    dismissed: integer('dismissed', { mode: 'boolean' }).default(false).notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('mail_link_entity_idx').on(table.entity_type, table.entity_id),
    index('mail_link_message_idx').on(table.mail_account_id, table.message_id)
  ]
)

// App settings (Einstellungen) as key/value pairs; values are JSON. Typed and
// defaulted by AppSettings in api/schemas/settings.schema.ts
export const app_setting = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: text('updated_at')
    .default(sql`(datetime('now'))`)
    .notNull()
})

// Saved mailing lists (Verteiler). kind 'filter': a name plus the filter,
// stored as JSON (ContactListFilters in api/schemas/contactList.schema.ts).
// kind 'members' (#154): the records in contact_list_member, e.g. from an
// imported CSV list; filters stays '{}'. Both are dynamic: recipients are
// computed from the current data on every load.
export const contact_list = sqliteTable('contact_list', {
  id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['filter', 'members'] })
    .default('filter')
    .notNull(),
  filters: text('filters').default('{}').notNull(),
  created_at: text('created_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
  updated_at: text('updated_at')
    .default(sql`(datetime('now'))`)
    .notNull()
})

// #154: the records of a member list. Exactly one of person, company and
// venue is set; the list mails that record's current primary address.
export const contact_list_member = sqliteTable(
  'contact_list_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    contact_list_id: integer('contact_list_id')
      .notNull()
      .references(() => contact_list.id, { onDelete: 'cascade' }),
    person_id: integer('person_id').references(() => person.id, { onDelete: 'cascade' }),
    company_id: integer('company_id').references(() => company.id, { onDelete: 'cascade' }),
    venue_id: integer('venue_id').references(() => venue.id, { onDelete: 'cascade' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    // NULLs are distinct in SQLite, so each index only binds rows of its kind
    uniqueIndex('contact_list_member_person_idx').on(table.contact_list_id, table.person_id),
    uniqueIndex('contact_list_member_company_idx').on(table.contact_list_id, table.company_id),
    uniqueIndex('contact_list_member_venue_idx').on(table.contact_list_id, table.venue_id),
    index('contact_list_member_person_id_idx').on(table.person_id),
    index('contact_list_member_company_id_idx').on(table.company_id),
    index('contact_list_member_venue_id_idx').on(table.venue_id),
    check(
      'contact_list_member_one_record',
      sql`(${table.person_id} IS NOT NULL) + (${table.company_id} IS NOT NULL) + (${table.venue_id} IS NOT NULL) = 1`
    )
  ]
)

// #123: the user's own mail templates (Vorlagen) for the mail client: a name, a subject and a
// plain-text body with {Platzhalter} (MAIL_TEMPLATE_PLACEHOLDERS in mail/mailTemplate.ts), filled
// from an event when one is chosen while composing.
// #136: with `kind` and `lang` a row is one of the eight fixed texts for invoices, reminders,
// dunning letters and contracts (DEFAULT_DOCUMENT_EMAILS), edited by the user; without a row the
// default applies, and "Zurücksetzen" deletes it. Own templates have neither (NULLs never clash
// in the unique index).
export const mail_template = sqliteTable(
  'mail_template',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    name: text('name').notNull(),
    subject: text('subject').default('').notNull(),
    body: text('body').default('').notNull(),
    kind: text('kind'), // 'invoice' | 'reminder' | 'dunning' | 'contract'
    lang: text('lang'), // 'de' | 'en'
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    uniqueIndex('mail_template_kind_lang_idx').on(table.kind, table.lang),
    oneOf('mail_template_kind_check', 'kind', DocumentEmailKind.options),
    oneOf('mail_template_lang_check', 'lang', DocumentEmailLang.options),
    // A fixed text has both, an own template neither
    check('mail_template_kind_lang_check', sql.raw('("kind" IS NULL) = ("lang" IS NULL)'))
  ]
)

// #124: rules for incoming mail (Regeln), per mail account. Each non-empty condition must match
// ("contains", case-insensitive; the address fields hold alternatives split on , or ;). The
// actions run in the worker's INBOX: mark, flag, move on the server (writable accounts only) and
// link to a record. A rule applies to mail received from active_since on - never to the mailbox
// it finds when created - and position orders them: the first matching rule with a folder moves.
export const mail_rule = sqliteTable(
  'mail_rule',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    mail_account_id: text('mail_account_id').notNull(),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    position: integer('position').default(0).notNull(),
    match_from: text('match_from').default('').notNull(),
    match_to: text('match_to').default('').notNull(),
    match_subject: text('match_subject').default('').notNull(),
    // IMAP path of the target folder; null = leave the mail in INBOX
    move_to_folder_path: text('move_to_folder_path'),
    mark_read: integer('mark_read', { mode: 'boolean' }).default(false).notNull(),
    mark_flagged: integer('mark_flagged', { mode: 'boolean' }).default(false).notNull(),
    // Like mail_link: a type plus an id, no FK; a deleted record ends the link action
    link_entity_type: text('link_entity_type', { enum: MAIL_LINK_ENTITY_TYPES }),
    link_entity_id: integer('link_entity_id'),
    active_since: text('active_since').notNull(), // UTC timestamp; set on create and when re-enabled
    hit_count: integer('hit_count').default(0).notNull(),
    last_applied_at: text('last_applied_at'),
    last_error: text('last_error'),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [index('mail_rule_account_idx').on(table.mail_account_id, table.position)]
)

// #124: the mails a rule has handled, by Message-ID (without brackets) or the fallback key, so a
// mail the user moves back into INBOX is not filed again.
export const mail_rule_hit = sqliteTable(
  'mail_rule_hit',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    rule_id: integer('rule_id')
      .notNull()
      .references(() => mail_rule.id, { onDelete: 'cascade' }),
    mail_key: text('mail_key').notNull(),
    applied_at: text('applied_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [uniqueIndex('mail_rule_hit_unique_idx').on(table.rule_id, table.mail_key)]
)

// Follow-ups (Wiedervorlagen): a date and a note, optionally on one record
// (at most one of the *_id columns is set; none = a general follow-up).
// Open while done_at is null. #121: one made when sending a mail names that
// mail (account + Message-ID without brackets); a reply closes it once and
// sets replied_at, which a later rescan never touches again.
export const follow_up = sqliteTable(
  'follow_up',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    due_date: text('due_date').notNull(), // YYYY-MM-DD
    note: text('note').notNull(),
    done_at: text('done_at'),
    event_id: integer('event_id').references(() => deal_memo.id, { onDelete: 'cascade' }),
    band_id: integer('band_id').references(() => band.id, { onDelete: 'cascade' }),
    venue_id: integer('venue_id').references(() => venue.id, { onDelete: 'cascade' }),
    company_id: integer('company_id').references(() => company.id, { onDelete: 'cascade' }),
    person_id: integer('person_id').references(() => person.id, { onDelete: 'cascade' }),
    invoice_id: integer('invoice_id').references(() => invoice.id, { onDelete: 'cascade' }),
    mail_account_id: text('mail_account_id'),
    mail_message_id: text('mail_message_id'),
    replied_at: text('replied_at'),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('follow_up_open_idx').on(table.done_at, table.due_date),
    index('follow_up_mail_idx').on(table.mail_account_id, table.mail_message_id),
    index('follow_up_event_idx').on(table.event_id),
    index('follow_up_band_idx').on(table.band_id),
    index('follow_up_venue_idx').on(table.venue_id),
    index('follow_up_company_idx').on(table.company_id),
    index('follow_up_person_idx').on(table.person_id),
    index('follow_up_invoice_idx').on(table.invoice_id),
    atMostOne('follow_up_one_record', [
      'event_id',
      'band_id',
      'venue_id',
      'company_id',
      'person_id',
      'invoice_id'
    ])
  ]
)

// ========================================
// Appointments (#71): the user's own entries in the calendar
// ========================================
// A meeting, a call, a rehearsal: with a time or all-day, optionally on one record. Unlike a
// follow-up the appointment still happens when that record goes, so the link is set to NULL
// instead of taking the appointment with it. A reminder fires `reminder_minutes` before the start
// (an all-day one before 08:00 of its day); reminded_at keeps it from firing twice and is cleared
// when the time or the reminder changes.
export const appointment = sqliteTable(
  'appointment',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    title: text('title').notNull(),
    start_date: text('start_date').notNull(), // YYYY-MM-DD
    start_time: text('start_time'), // HH:MM, NULL for all-day
    end_date: text('end_date').notNull(), // YYYY-MM-DD, the start day for one day
    end_time: text('end_time'), // HH:MM, NULL for all-day
    place: text('place').notNull().default(''),
    notes: text('notes').notNull().default(''),
    reminder_minutes: integer('reminder_minutes'),
    reminded_at: text('reminded_at'),
    // The UID of the invitation it was taken over from: taking it over again updates this row
    ical_uid: text('ical_uid'),
    event_id: integer('event_id').references(() => deal_memo.id, { onDelete: 'set null' }),
    band_id: integer('band_id').references(() => band.id, { onDelete: 'set null' }),
    venue_id: integer('venue_id').references(() => venue.id, { onDelete: 'set null' }),
    company_id: integer('company_id').references(() => company.id, { onDelete: 'set null' }),
    person_id: integer('person_id').references(() => person.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('appointment_start_idx').on(table.start_date),
    index('appointment_event_idx').on(table.event_id),
    index('appointment_band_idx').on(table.band_id),
    index('appointment_venue_idx').on(table.venue_id),
    index('appointment_company_idx').on(table.company_id),
    index('appointment_person_idx').on(table.person_id),
    uniqueIndex('appointment_ical_uid_idx').on(table.ical_uid),
    atMostOne('appointment_one_record', [
      'event_id',
      'band_id',
      'venue_id',
      'company_id',
      'person_id'
    ])
  ]
)

// ========================================
// Agency bookings (#103): shows of the user's bands that another agency booked
// ========================================
// Read-only copies from an agency's export, so tour planning, the calendar and the radius
// clauses see them. A table of their own rather than a flag on deal_memo: no invoice, contract,
// Abrechnung, mailing list or follow-up path reads this table, so none can pick one up. Rows
// change only through a new import, which finds a row by (agency, source_key) and updates it.
export const external_booking = sqliteTable(
  'external_booking',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    band_id: integer('band_id')
      .notNull()
      .references(() => band.id, { onDelete: 'cascade' }),
    date: text('date').notNull(), // YYYY-MM-DD
    // 'venue' (club) or 'festival': picks the default radius clause
    kind: text('kind').notNull().default('venue'),
    // 'confirmed' blocks like a confirmed show, 'pending' is a risk, 'cancelled' is kept but inert
    status: text('status').notNull().default('confirmed'),
    venue_name: text('venue_name').notNull().default(''),
    street: text('street').notNull().default(''),
    zip_code: text('zip_code').notNull().default(''),
    city: text('city').notNull().default(''),
    country: text('country').notNull().default(''),
    notes: text('notes').notNull().default(''),
    // Who booked it (the source), and the row's key within that source's exports
    agency: text('agency').notNull(),
    source_key: text('source_key').notNull(),
    // The file the row last came from, and when
    source_file: text('source_file').notNull().default(''),
    imported_at: text('imported_at').notNull(),
    // The export's own radius clause (Gebietsschutz); null fields take the kind's default
    radius_km: integer('radius_km'),
    radius_weeks_before: integer('radius_weeks_before'),
    radius_weeks_after: integer('radius_weeks_after'),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('external_booking_date_idx').on(table.date),
    index('external_booking_band_idx').on(table.band_id),
    uniqueIndex('external_booking_source_idx').on(table.agency, table.source_key),
    oneOf('external_booking_kind_check', 'kind', ExternalBookingKind.options),
    oneOf('external_booking_status_check', 'status', ExternalBookingStatus.options)
  ]
)

// ========================================
// Management contracts (management company <-> band)
// ========================================
// A band can have several over time (renewals with new terms); the newest
// is the current one. Defaults follow the agency's contract draft.

export const management_contract = sqliteTable(
  'management_contract',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    band_id: integer('band_id')
      .notNull()
      .references(() => band.id, { onDelete: 'cascade' }),
    // MANAGEMENT party, fixed per contract (prefilled from the band's
    // management company, else the default own company)
    management_company_id: integer('management_company_id').references(() => company.id, {
      onDelete: 'set null'
    }),
    // Contract start (date of the last signature), once known
    start_date: text('start_date'),
    territory: text('territory').default('örtlich unbeschränkt').notNull(),
    term_years: integer('term_years').default(3).notNull(),
    renewal_years: integer('renewal_years').default(1).notNull(),
    notice_months: integer('notice_months').default(6).notNull(),
    commission_percent: real('commission_percent').default(20).notNull(),
    excluded_income: text('excluded_income').default('GVL und GEMA Einnahmen').notNull(),
    statement_email: text('statement_email').default('').notNull(),
    settlement_days: integer('settlement_days').default(30).notNull(),
    payment_days: integer('payment_days').default(14).notNull(),
    // Post-term share in % of the commission, years 1-3 after the end
    post_term_year1_percent: real('post_term_year1_percent').default(30).notNull(),
    post_term_year2_percent: real('post_term_year2_percent').default(0).notNull(),
    post_term_year3_percent: real('post_term_year3_percent').default(0).notNull(),
    // Member authorized to receive notices, statements and payments
    representative_person_id: integer('representative_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),
    special_clauses: text('special_clauses').default('').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [index('management_contract_band_idx').on(table.band_id)]
)

// Members/shareholders named in the group clause (§ 15)
export const management_contract_member = sqliteTable(
  'management_contract_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    contract_id: integer('contract_id')
      .notNull()
      .references(() => management_contract.id, { onDelete: 'cascade' }),
    person_id: integer('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' })
  },
  (table) => [
    uniqueIndex('management_contract_member_unique_idx').on(table.contract_id, table.person_id)
  ]
)

// Quarterly management share ("Managementbeteiligung"): the invoice billed
// to the band for one quarter, with the % applied and the band's reported
// net income it was computed from. Deleting the (draft) invoice removes it.
export const management_share = sqliteTable(
  'management_share',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    band_id: integer('band_id')
      .notNull()
      .references(() => band.id, { onDelete: 'cascade' }),
    management_contract_id: integer('management_contract_id').references(
      () => management_contract.id,
      { onDelete: 'set null' }
    ),
    year: integer('year').notNull(),
    quarter: integer('quarter').notNull(),
    commission_percent: real('commission_percent').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    uniqueIndex('management_share_invoice_unique_idx').on(table.invoice_id),
    index('management_share_band_period_idx').on(table.band_id, table.year, table.quarter),
    check('management_share_quarter_check', sql.raw('"quarter" BETWEEN 1 AND 4'))
  ]
)

// The band's net income lines for a quarter (e.g. Konzerte, Merchandise)
export const management_share_income = sqliteTable(
  'management_share_income',
  {
    id: integer('id').primaryKey({ autoIncrement: true }).$defaultFn(nextRowId),
    share_id: integer('share_id')
      .notNull()
      .references(() => management_share.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    net_cents: integer('net_cents').default(0).notNull()
  },
  (table) => [index('management_share_income_share_idx').on(table.share_id)]
)

// ========================================
// Schema Export for Drizzle Utilities
// ========================================

// Export all tables as a single schema object
// Useful for migrations, introspection, and type inference
export const schema = {
  address,
  contact,
  contact_email,
  bank,
  person,
  company,
  company_member,
  band,
  band_member,
  venue,
  venue_member,
  genre,
  venue_genre,
  company_genre,
  band_genre,
  hotel,
  deal_memo,
  deal_memo_deposit,
  itinerary,
  document,
  company_invoice_settings,
  invoice,
  invoice_party_snapshot,
  invoice_line_item,
  invoice_email,
  invoice_email_pending,
  invoice_status_change,
  datev_transfer,
  management_contract,
  management_contract_member,
  management_share,
  management_share_income,
  app_setting,
  contact_list,
  contact_list_member,
  mail_link,
  follow_up,
  appointment,
  external_booking,
  mail_template,
  mail_rule,
  mail_rule_hit
}
