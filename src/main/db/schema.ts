import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ========================================
// Normalized Reference Tables
// ========================================

// Address table (singular form following SQL best practices)
export const address = sqliteTable(
  'address',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').default('').notNull(),
    phone: text('phone'),
    mobile_phone: text('mobile_phone'),
    homepage: text('homepage')
  },
  (table) => [index('contact_email_idx').on(table.email)]
)

// Bank table
export const bank = sqliteTable(
  'bank',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    id: integer('id').primaryKey({ autoIncrement: true }),
    first_name: text('first_name').notNull(),
    last_name: text('last_name').notNull(),
    birthday: text('birthday'), // ISO 8601 format: YYYY-MM-DD
    notes: text('notes'),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
  },
  (table) => [index('person_name_idx').on(table.first_name, table.last_name)]
)

// Company table
export const company = sqliteTable(
  'company',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    notes: text('notes'),
    bank_id: integer('bank_id').references(() => bank.id, { onDelete: 'set null' }),
    vat_number: text('vat_number').default('').notNull(),
    ust_number: text('ust_number').default('').notNull(),
    tax_number: text('tax_number').default('').notNull(),
    commercial_register_no: text('commercial_register_no').default('').notNull(),
    register_court: text('register_court').default('').notNull(),
    logo_path: text('logo_path').default('').notNull(),
    signature_path: text('signature_path').default('').notNull(),
    ksk_number: text('ksk_number').default('').notNull(),
    is_default_for_invoicing: integer('is_default_for_invoicing', { mode: 'boolean' })
      .default(false)
      .notNull(),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
  },
  (table) => [index('company_name_idx').on(table.name)]
)

// Company member junction table
export const company_member = sqliteTable(
  'company_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    genre: text('genre').default('').notNull(),
    founded: text('founded'), // ISO 8601 format: YYYY-MM-DD
    notes: text('notes').default('').notNull(),
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
  (table) => [index('band_name_idx').on(table.name), index('band_company_idx').on(table.company_id)]
)

// Band member junction table
export const band_member = sqliteTable(
  'band_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    // 'venue' (club, hall, theatre, ...) or 'festival'
    kind: text('kind').default('venue').notNull(),
    capacity: integer('capacity'),
    notes: text('notes').default('').notNull(),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    // owner, but not required
    company_id: integer('company_id').references(() => company.id, { onDelete: 'set null' }),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
  },
  (table) => [
    index('venue_name_idx').on(table.name),
    index('venue_company_idx').on(table.company_id)
  ]
)

// Venue member junction table
export const venue_member = sqliteTable(
  'venue_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    index('venue_member_person_idx').on(table.person_id)
  ]
)

// Hotel table
export const hotel = sqliteTable(
  'hotel',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    notes: text('notes'),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
  },
  (table) => [index('hotel_name_idx').on(table.name)]
)

// Deal memo table
export const deal_memo = sqliteTable(
  'deal_memo',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    deal: text('deal').notNull().default(''), // financial deal terms, e.g. "70/30"
    date: text('date').notNull(), // ISO 8601 format: YYYY-MM-DD
    ticket_price_vvk: real('ticket_price_vvk'),
    ticket_price_ak: real('ticket_price_ak'),
    posters: text('posters').default('').notNull(),
    status: text('status').default('').notNull(),
    notes: text('notes').default('').notNull(),
    amount_of_people: integer('amount_of_people').default(0),
    room_information: text('room_information').default(''),
    performance_duration: text('performance_duration').default(''),
    performance_time: text('performance_time').default(''),
    performance_information: text('performance_information').default(''),
    guarantee_amount: real('guarantee_amount'),
    guarantee_vat_rate: real('guarantee_vat_rate'),
    contract_notes: text('contract_notes').default(''),
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
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
  },
  (table) => [
    index('deal_memo_name_idx').on(table.name),
    index('deal_memo_date_idx').on(table.date),
    index('deal_memo_band_idx').on(table.band_id),
    index('deal_memo_venue_idx').on(table.venue_id),
    index('deal_memo_invoice_company_idx').on(table.invoice_company_id),
    index('deal_memo_status_idx').on(table.status)
  ]
)

// Per-company invoice numbering settings
export const company_invoice_settings = sqliteTable(
  'company_invoice_settings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    company_id: integer('company_id')
      .notNull()
      .references(() => company.id, { onDelete: 'cascade' }),
    next_invoice_number: integer('next_invoice_number').default(1).notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
  },
  (table) => [
    uniqueIndex('company_invoice_settings_company_unique_idx').on(table.company_id),
    index('company_invoice_settings_next_number_idx').on(table.next_invoice_number)
  ]
)

// Immutable invoice party snapshots (issuer/recipient data at invoice issue time)
export const invoice_party_snapshot = sqliteTable(
  'invoice_party_snapshot',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(), // company | band | person | other
    source_company_id: integer('source_company_id').references(() => company.id, {
      onDelete: 'set null'
    }),
    source_band_id: integer('source_band_id').references(() => band.id, { onDelete: 'set null' }),
    source_person_id: integer('source_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),
    legal_name: text('legal_name').notNull(),
    street: text('street').default('').notNull(),
    street_number: text('street_number').default('').notNull(),
    zip_code: text('zip_code').default('').notNull(),
    city: text('city').default('').notNull(),
    country: text('country').default('').notNull(),
    country_code: text('country_code', { length: 2 }).default('').notNull(),
    vat_number: text('vat_number').default('').notNull(),
    ust_number: text('ust_number').default('').notNull(),
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
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('invoice_party_snapshot_kind_idx').on(table.kind),
    index('invoice_party_snapshot_legal_name_idx').on(table.legal_name)
  ]
)

// Invoice table
export const invoice = sqliteTable(
  'invoice',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    subtotal_net_amount: real('subtotal_net_amount').default(0).notNull(),
    subtotal_tax_amount: real('subtotal_tax_amount').default(0).notNull(),
    total_gross_amount: real('total_gross_amount').default(0).notNull(),
    total_amount: real('total_amount').default(0).notNull(),
    payment_terms: text('payment_terms').default('').notNull(),
    reverse_charge_note: text('reverse_charge_note').default('').notNull(),
    notes: text('notes').default('').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
  },
  (table) => [
    index('invoice_company_idx').on(table.company_id),
    index('invoice_recipient_snapshot_idx').on(table.recipient_snapshot_id),
    index('invoice_deal_memo_idx').on(table.deal_memo_id),
    index('invoice_status_idx').on(table.status),
    index('invoice_issue_date_idx').on(table.issue_date),
    index('invoice_period_start_idx').on(table.period_start_date),
    uniqueIndex('invoice_company_invoice_number_unique_idx').on(
      table.company_id,
      table.invoice_number
    )
  ]
)

// Invoice line items with tax-aware totals
export const invoice_line_item = sqliteTable(
  'invoice_line_item',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    position: integer('position').default(1).notNull(),
    description: text('description').notNull(),
    quantity: real('quantity').default(1).notNull(),
    unit: text('unit').default('service').notNull(),
    unit_price_net: real('unit_price_net').default(0).notNull(),
    line_net_amount: real('line_net_amount').default(0).notNull(),
    tax_rate: real('tax_rate').default(0).notNull(),
    tax_code: text('tax_code').default('standard').notNull(),
    line_tax_amount: real('line_tax_amount').default(0).notNull(),
    line_gross_amount: real('line_gross_amount').default(0).notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('invoice_line_item_invoice_idx').on(table.invoice_id),
    index('invoice_line_item_position_idx').on(table.invoice_id, table.position)
  ]
)

export const itinerary = sqliteTable(
  'itinerary',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
  },
  (table) => [
    uniqueIndex('itinerary_deal_memo_idx').on(table.deal_memo_id) // One itinerary per deal memo
  ]
)

// Document table - stores metadata for files associated with deal memos/events
export const document = sqliteTable(
  'document',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deal_memo_id: integer('deal_memo_id')
      .notNull()
      .references(() => deal_memo.id, { onDelete: 'cascade' }),
    file_name: text('file_name').notNull(),
    file_type: text('file_type').notNull(),
    file_path: text('file_path').notNull(),
    document_type: text('document_type').notNull().default('other'),
    file_size: integer('file_size').notNull(),
    uploaded_at: text('uploaded_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    uploaded_by: text('uploaded_by'),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
  },
  (table) => [
    index('document_deal_memo_idx').on(table.deal_memo_id),
    index('document_type_idx').on(table.document_type),
    index('document_uploaded_at_idx').on(table.uploaded_at)
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
    id: integer('id').primaryKey({ autoIncrement: true }),
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
  },
  (table) => [index('management_contract_band_idx').on(table.band_id)]
)

// Members/shareholders named in the group clause (§ 15)
export const management_contract_member = sqliteTable(
  'management_contract_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    quarter: integer('quarter').notNull(), // 1-4
    commission_percent: real('commission_percent').notNull(),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    uniqueIndex('management_share_invoice_unique_idx').on(table.invoice_id),
    index('management_share_band_period_idx').on(table.band_id, table.year, table.quarter)
  ]
)

// The band's net income lines for a quarter (e.g. Konzerte, Merchandise)
export const management_share_income = sqliteTable(
  'management_share_income',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    share_id: integer('share_id')
      .notNull()
      .references(() => management_share.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    net_amount: real('net_amount').notNull()
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
  bank,
  person,
  company,
  company_member,
  band,
  band_member,
  venue,
  venue_member,
  hotel,
  deal_memo,
  itinerary,
  document,
  company_invoice_settings,
  invoice,
  invoice_party_snapshot,
  invoice_line_item,
  management_contract,
  management_contract_member,
  management_share,
  management_share_income
}
