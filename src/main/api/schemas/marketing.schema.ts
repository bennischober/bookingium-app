import { z } from 'zod'
import { t } from '../../i18n/translate'

// Marketing-Atlas of a band: the researched radios, podcasts, press, festivals, clubs and further
// channels, each with priority, reason, way in and timing, and a status the team keeps up to date

/** The atlas tabs; ids as the atlas pages use them */
export const MarketingCategory = z.enum([
  'radios',
  'podcasts',
  'presse',
  'social',
  'festivals',
  'clubs',
  'kanaele',
  'sync',
  'inspiration',
  'ausland'
])
export type MarketingCategory = z.infer<typeof MarketingCategory>

export const MARKETING_CATEGORY_LABELS: Record<MarketingCategory, string> = {
  radios: t('Radios'),
  podcasts: t('Podcasts'),
  presse: t('Presse und Blogs'),
  social: t('Social und Creator'),
  festivals: t('Festivals'),
  clubs: t('Clubs'),
  kanaele: t('Weitere Kanäle'),
  sync: t('Sync, Film, Gaming'),
  inspiration: t('Inspiration'),
  ausland: t('Auslandsmärkte')
}

export const MarketingPriority = z.enum(['A', 'B', 'C'])
export type MarketingPriority = z.infer<typeof MarketingPriority>

/** How well an entry is backed by its source: belegt, zu prüfen, Idee */
export const MarketingQuality = z.enum(['b', 'w', 'i'])
export type MarketingQuality = z.infer<typeof MarketingQuality>

export const MARKETING_QUALITY_LABELS: Record<MarketingQuality, string> = {
  b: t('belegt'),
  w: t('zu prüfen'),
  i: t('Idee')
}

export const MarketingStatus = z.enum([
  'open',
  'contacted',
  'talking',
  'positive',
  'declined',
  'active'
])
export type MarketingStatus = z.infer<typeof MarketingStatus>

export const MARKETING_STATUS_LABELS: Record<MarketingStatus, string> = {
  open: t('Offen'),
  contacted: t('Angefragt'),
  talking: t('Im Gespräch'),
  positive: t('Zugesagt'),
  declined: t('Absage'),
  active: t('Läuft schon')
}

export const MarketingItemDto = z.object({
  id: z.number(),
  bandId: z.number(),
  category: MarketingCategory,
  group: z.string(),
  name: z.string(),
  country: z.string(),
  type: z.string(),
  priority: MarketingPriority,
  reason: z.string(),
  approach: z.string(),
  timing: z.string(),
  quality: MarketingQuality,
  sourceUrl: z.string(),
  contactEmail: z.string(),
  contactUrl: z.string(),
  contactNote: z.string(),
  /** An existing relationship the atlas names ("Red war Album der Woche") */
  activeNote: z.string(),
  status: MarketingStatus,
  statusNote: z.string(),
  statusDate: z.string().nullable(),
  companyId: z.number().nullable(),
  companyName: z.string().nullable(),
  venueId: z.number().nullable(),
  venueName: z.string().nullable(),
  /** false once a newer atlas no longer lists it */
  inAtlas: z.boolean(),
  /** The furthest measure booked for it (Maßnahmen), null for none */
  actionStatus: z.enum(['planned', 'booked', 'running', 'done']).nullable()
})
export type MarketingItemDto = z.infer<typeof MarketingItemDto>

export const MarketingAtlasDto = z.object({
  bandId: z.number(),
  stand: z.string(),
  run: z.number().nullable(),
  lead: z.string(),
  facts: z.array(z.tuple([z.string(), z.string()])),
  refs: z.array(z.string()),
  tabs: z.array(z.object({ id: z.string(), label: z.string(), lead: z.string() })),
  runs: z.array(z.object({ run: z.number().nullable(), date: z.string(), text: z.string() })),
  excluded: z.array(z.object({ name: z.string(), category: z.string(), reason: z.string() })),
  sourceName: z.string(),
  importedAt: z.string()
})
export type MarketingAtlasDto = z.infer<typeof MarketingAtlasDto>

/** The entries of one band's atlas and its head data */
export const MarketingOverviewDto = z.object({
  atlas: MarketingAtlasDto.nullable(),
  items: z.array(MarketingItemDto)
})
export type MarketingOverviewDto = z.infer<typeof MarketingOverviewDto>

/** Which researched contacts the import adds to the address book */
export const MarketingContactScope = z.enum(['ab', 'all', 'none'])
export type MarketingContactScope = z.infer<typeof MarketingContactScope>

export const MarketingImportInput = z.object({
  bandId: z.number().int().positive(),
  /** The file picked with pickAtlas */
  path: z.string().min(1),
  contacts: MarketingContactScope.default('ab'),
  /** One member list (Verteiler) per tab with the linked contacts */
  contactLists: z.boolean().default(false)
})
export type MarketingImportInput = z.infer<typeof MarketingImportInput>

export const MarketingImportResultDto = z.object({
  created: z.number(),
  updated: z.number(),
  /** Entries a newer atlas no longer lists; kept with their status */
  dropped: z.number(),
  companiesCreated: z.number(),
  venuesCreated: z.number(),
  linked: z.number(),
  lists: z.number()
})
export type MarketingImportResultDto = z.infer<typeof MarketingImportResultDto>

/** What a picked file holds, before it is imported */
export const MarketingFileDto = z.object({
  path: z.string(),
  fileName: z.string(),
  band: z.string(),
  stand: z.string(),
  counts: z.array(z.object({ category: MarketingCategory, count: z.number() })),
  total: z.number()
})
export type MarketingFileDto = z.infer<typeof MarketingFileDto>

export const UpdateMarketingItemInput = z.object({
  id: z.number().int().positive(),
  status: MarketingStatus.optional(),
  statusNote: z.string().optional()
})
export type UpdateMarketingItemInput = z.infer<typeof UpdateMarketingItemInput>

/** The entries that name a company or club/festival, with their band (its detail page) */
export const MarketingLinkDto = z.object({
  id: z.number(),
  bandId: z.number(),
  bandName: z.string(),
  category: MarketingCategory,
  priority: MarketingPriority,
  status: MarketingStatus,
  statusNote: z.string()
})
export type MarketingLinkDto = z.infer<typeof MarketingLinkDto>

// ========================================
// Maßnahmen: what is actually booked for a band (radio spots, posters, ads …)
// ========================================

export const MarketingActionKind = z.enum([
  'radio_spot',
  'poster',
  'print_ad',
  'online_ad',
  'interview',
  'playlist',
  'giveaway',
  'other'
])
export type MarketingActionKind = z.infer<typeof MarketingActionKind>

export const MARKETING_ACTION_KIND_LABELS: Record<MarketingActionKind, string> = {
  radio_spot: t('Radiospot'),
  poster: t('Plakat / Banner'),
  print_ad: t('Print-Anzeige'),
  online_ad: t('Online- / Social-Anzeige'),
  interview: t('Interview / Feature'),
  playlist: t('Playlist'),
  giveaway: t('Gewinnspiel'),
  other: t('Sonstiges')
}

export const MarketingActionStatus = z.enum(['planned', 'booked', 'running', 'done', 'cancelled'])
export type MarketingActionStatus = z.infer<typeof MarketingActionStatus>

export const MARKETING_ACTION_STATUS_LABELS: Record<MarketingActionStatus, string> = {
  planned: t('Geplant'),
  booked: t('Gebucht'),
  running: t('Läuft'),
  done: t('Abgeschlossen'),
  cancelled: t('Abgesagt')
}

/** Who pays for a measure */
export const MarketingPayer = z.enum(['us', 'band', 'label', 'promoter', 'other'])
export type MarketingPayer = z.infer<typeof MarketingPayer>

export const MARKETING_PAYER_LABELS: Record<MarketingPayer, string> = {
  us: t('Wir'),
  band: t('Band'),
  label: t('Label'),
  promoter: t('Veranstalter'),
  other: t('Sonstige')
}

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')
  .nullable()

export const MarketingActionFields = z.object({
  bandId: z.number().int().positive(),
  kind: MarketingActionKind,
  title: z.string().trim().min(1, 'Bitte eine Bezeichnung angeben'),
  status: MarketingActionStatus.default('planned'),
  /** The show it is for; the tour follows from it unless typed */
  dealMemoId: z.number().int().positive().nullable().default(null),
  tour: z.string().trim().default(''),
  release: z.string().trim().default(''),
  /** The station, magazine or company it runs with */
  companyId: z.number().int().positive().nullable().default(null),
  /** The atlas entry it comes from */
  marketingItemId: z.number().int().positive().nullable().default(null),
  startDate: IsoDate.default(null),
  endDate: IsoDate.default(null),
  region: z.string().trim().default(''),
  /** Net, in cents */
  costCents: z.number().int().nonnegative().nullable().default(null),
  payer: MarketingPayer.default('us'),
  receiptId: z.number().int().positive().nullable().default(null),
  notes: z.string().trim().default('')
})
export type MarketingActionFields = z.infer<typeof MarketingActionFields>

export const CreateMarketingActionInput = MarketingActionFields
export type CreateMarketingActionInput = z.infer<typeof CreateMarketingActionInput>

export const UpdateMarketingActionInput = MarketingActionFields.extend({
  id: z.number().int().positive()
})
export type UpdateMarketingActionInput = z.infer<typeof UpdateMarketingActionInput>

export const MarketingActionDto = z.object({
  id: z.number(),
  bandId: z.number(),
  bandName: z.string(),
  kind: MarketingActionKind,
  title: z.string(),
  status: MarketingActionStatus,
  dealMemoId: z.number().nullable(),
  /** "Leipzig, Club Probe · 12.3.2027" */
  showLabel: z.string().nullable(),
  showDate: z.string().nullable(),
  tour: z.string(),
  release: z.string(),
  companyId: z.number().nullable(),
  companyName: z.string().nullable(),
  marketingItemId: z.number().nullable(),
  marketingItemName: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  region: z.string(),
  costCents: z.number().nullable(),
  payer: MarketingPayer,
  receiptId: z.number().nullable(),
  receiptName: z.string().nullable(),
  invoiceId: z.number().nullable(),
  /** The invoice's number once it is issued */
  invoiceNumber: z.number().nullable(),
  notes: z.string()
})
export type MarketingActionDto = z.infer<typeof MarketingActionDto>

/** Where a list of measures is shown */
export const MarketingActionScope = z.object({
  bandId: z.number().int().optional(),
  dealMemoId: z.number().int().optional(),
  companyId: z.number().int().optional()
})
export type MarketingActionScope = z.infer<typeof MarketingActionScope>

/** "Rechnung erstellen": a draft invoice for the measure's cost, to the band or a company */
export const MarketingActionInvoiceInput = z.object({
  id: z.number().int().positive(),
  recipient: z.enum(['band', 'company']),
  /** For recipient 'company' */
  recipientCompanyId: z.number().int().positive().nullable().default(null)
})
export type MarketingActionInvoiceInput = z.infer<typeof MarketingActionInvoiceInput>
