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
    address_suffix: text('address_suffix').default('').notNull(),
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
    phone: text('phone').default('').notNull(),
    mobile_phone: text('mobile_phone').default('').notNull(),
    homepage: text('homepage').default('').notNull()
  },
  (table) => [index('contact_email_idx').on(table.email)]
)

// Contact phone numbers - separate table for additional phone numbers
export const contact_phone_number = sqliteTable(
  'contact_phone_number',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contact_id: integer('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    identifier: text('identifier').notNull(), // e.g., "Work", "Fax", "Emergency"
    phone_number: text('phone_number').notNull()
  },
  (table) => [index('contact_phone_number_contact_idx').on(table.contact_id)]
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
    role: text('role').default('').notNull(),
    notes: text('notes').default('').notNull(),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [index('person_name_idx').on(table.first_name, table.last_name)]
)

// Company table
export const company = sqliteTable(
  'company',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    notes: text('notes').default('').notNull(),
    bank_id: integer('bank_id').references(() => bank.id, { onDelete: 'set null' }),
    vat_number: text('vat_number').default('').notNull(),
    ust_number: text('ust_number').default('').notNull(),
    address_id: integer('address_id').references(() => address.id, { onDelete: 'set null' }),
    contact_id: integer('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
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
      .references(() => person.id, { onDelete: 'cascade' })
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
      .references(() => person.id, { onDelete: 'cascade' })
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
    capacity: integer('capacity'),
    notes: text('notes').default('').notNull(),
    company_id: integer('company_id')
      .notNull()
      .references(() => company.id),
    created_at: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updated_at: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull()
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
    identifier: text('identifier').default('').notNull() // e.g., "Stage Manager", "Technical Director"
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
    notes: text('notes').default('').notNull(),
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
    id: integer('id').primaryKey({ autoIncrement: true }),
    deal: text('deal').notNull(),
    date: text('date').notNull(), // ISO 8601 format: YYYY-MM-DD
    ticket_price_vvk: real('ticket_price_vvk'),
    ticket_price_ak: real('ticket_price_ak'),
    posters: text('posters').default('').notNull(),
    status: text('status').default('').notNull(),
    notes: text('notes').default('').notNull(),
    amount_of_people: integer('amount_of_people').default(0).notNull(),
    room_information: text('room_information').default('').notNull(),
    performance_duration: text('performance_duration').default('').notNull(),
    performance_time: text('performance_time').default('').notNull(),
    performance_information: text('performance_information').default('').notNull(),
    lopro_person_id: integer('lopro_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),
    lopro_company_id: integer('lopro_company_id').references(() => company.id, {
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
      .default(sql`(datetime('now'))`)
      .notNull()
  },
  (table) => [
    index('deal_memo_date_idx').on(table.date),
    index('deal_memo_band_idx').on(table.band_id),
    index('deal_memo_venue_idx').on(table.venue_id),
    index('deal_memo_status_idx').on(table.status)
  ]
)

// Itinerary table
export const itinerary = sqliteTable(
  'itinerary',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    notes: text('notes').default('').notNull(),
    venue_id: integer('venue_id')
      .notNull()
      .references(() => venue.id),
    hotel_id: integer('hotel_id')
      .notNull()
      .references(() => hotel.id),
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
    uniqueIndex('itinerary_deal_memo_idx').on(table.deal_memo_id), // One itinerary per deal memo
    index('itinerary_venue_idx').on(table.venue_id),
    index('itinerary_hotel_idx').on(table.hotel_id)
  ]
)

// ========================================
// Schema Export for Drizzle Utilities
// ========================================

// Export all tables as a single schema object
// Useful for migrations, introspection, and type inference
export const schema = {
  address,
  contact,
  contact_phone_number,
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
  itinerary
}
