// ========================================
// Which data the sync carries, and how rows are identified
// ========================================
// Pure configuration, no database access. The table list is read from the live schema
// (PRAGMA) at runtime; this file only names the exceptions.

/**
 * Tables that stay on each computer. They belong to the local mail accounts (whose ids differ
 * per computer) or to a send in progress on this computer:
 * - mail_link: the linker of each computer builds the links from its own mail store
 * - mail_rule, mail_rule_hit: rules act on a local mail account and track its messages
 * - invoice_email_pending: a send this computer's mail client is doing right now
 */
export const LOCAL_TABLES: ReadonlySet<string> = new Set([
  'mail_link',
  'mail_rule',
  'mail_rule_hit',
  'invoice_email_pending'
])

/** app_setting keys that describe this computer, not the shared data */
export const LOCAL_SETTING_KEYS: readonly string[] = [
  'calendarFeedPath',
  'invoiceMailAccountId',
  'mailNotifications',
  'mailInAppNotifications',
  'mailCloseToTray',
  'reminderNotifications',
  'followUpSummaryDay',
  'mailAccountAddresses'
]
/** app_setting key prefixes of per-mail-account cursors (local accounts) */
export const LOCAL_SETTING_PREFIXES: readonly string[] = [
  'mailLinkCursor:',
  'mailLinkAddresses:',
  'mailRuleCursor:'
]

export function isLocalSettingKey(key: string): boolean {
  return LOCAL_SETTING_KEYS.includes(key) || LOCAL_SETTING_PREFIXES.some((p) => key.startsWith(p))
}

/** SQL condition (on `ref`, NEW or OLD) that is true for a shared app_setting row */
export function sharedSettingCondition(ref: 'NEW' | 'OLD'): string {
  const keys = LOCAL_SETTING_KEYS.map((k) => `'${k}'`).join(', ')
  const prefixes = LOCAL_SETTING_PREFIXES.map((p) => ` AND ${ref}.key NOT LIKE '${p}%'`).join('')
  return `${ref}.key NOT IN (${keys})${prefixes}`
}

/** The text column that identifies a row of a table without an integer id */
export const TEXT_KEY_TABLES: Readonly<Record<string, string>> = { app_setting: 'key' }

/**
 * Tables whose unique key means "the same thing": when two computers create the same row
 * independently (the same person in the same band, a genre typed on both), the incoming row is
 * not a conflict but the local one under another id. The sync then remembers the alias and
 * merges the fields. `columns` are compared with IS (NULL equals NULL); `nocase` columns
 * case-insensitively.
 */
export type AliasKey = { columns: readonly string[]; nocase?: readonly string[] }
export const ALIAS_KEYS: Readonly<Record<string, readonly AliasKey[]>> = {
  contact_email: [{ columns: ['contact_id', 'email'] }],
  company_member: [{ columns: ['company_id', 'person_id'] }],
  band_member: [{ columns: ['band_id', 'person_id'] }],
  venue_member: [{ columns: ['venue_id', 'person_id'] }],
  genre: [{ columns: ['name'], nocase: ['name'] }],
  venue_genre: [{ columns: ['venue_id', 'genre_id'] }],
  company_genre: [{ columns: ['company_id', 'genre_id'] }],
  band_genre: [{ columns: ['band_id', 'genre_id'] }],
  company_invoice_settings: [{ columns: ['company_id'] }],
  itinerary: [{ columns: ['deal_memo_id'] }],
  contact_list_member: [
    { columns: ['contact_list_id', 'person_id'] },
    { columns: ['contact_list_id', 'company_id'] },
    { columns: ['contact_list_id', 'venue_id'] }
  ],
  mail_template: [{ columns: ['kind', 'lang'] }],
  appointment: [{ columns: ['ical_uid'] }],
  external_booking: [{ columns: ['agency', 'source_key'] }],
  management_contract_member: [{ columns: ['contract_id', 'person_id'] }],
  management_share: [{ columns: ['invoice_id'] }]
}

/**
 * Columns holding a path inside storage/. A file the joining computer brings that collides with
 * a different file of the same path is stored under a new path, and these columns follow it.
 */
export const STORAGE_PATH_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  document: ['file_path'],
  company: ['logo_path', 'signature_path'],
  invoice_party_snapshot: ['logo_path']
}

/** document.owner_type -> table (the owner has no foreign key) */
export const DOCUMENT_OWNER_TABLES: Readonly<Record<string, string>> = {
  event: 'deal_memo',
  band: 'band',
  company: 'company',
  venue: 'venue',
  person: 'person'
}
