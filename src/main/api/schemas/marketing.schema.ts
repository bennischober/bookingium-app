import { z } from 'zod'

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
  radios: 'Radios',
  podcasts: 'Podcasts',
  presse: 'Presse und Blogs',
  social: 'Social und Creator',
  festivals: 'Festivals',
  clubs: 'Clubs',
  kanaele: 'Weitere Kanäle',
  sync: 'Sync, Film, Gaming',
  inspiration: 'Inspiration',
  ausland: 'Auslandsmärkte'
}

export const MarketingPriority = z.enum(['A', 'B', 'C'])
export type MarketingPriority = z.infer<typeof MarketingPriority>

/** How well an entry is backed by its source: belegt, zu prüfen, Idee */
export const MarketingQuality = z.enum(['b', 'w', 'i'])
export type MarketingQuality = z.infer<typeof MarketingQuality>

export const MARKETING_QUALITY_LABELS: Record<MarketingQuality, string> = {
  b: 'belegt',
  w: 'zu prüfen',
  i: 'Idee'
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
  open: 'Offen',
  contacted: 'Angefragt',
  talking: 'Im Gespräch',
  positive: 'Zugesagt',
  declined: 'Absage',
  active: 'Läuft schon'
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
  inAtlas: z.boolean()
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
