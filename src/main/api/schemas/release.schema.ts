import { z } from 'zod'
import { t } from '../../i18n/translate'
import { TimestampFields, createPaginatedResponse } from './base.schema'

// ========================================
// Releases (#289): the label copy of a record, kept in one place
// ========================================
// A release (album, EP, single) comes out as one or more products (digital, CD, vinyl, each
// with its own UPC and catalogue number) that share the same tracks (one ISRC each). A track
// carries its performers and the shares of the work behind it.

export const ReleaseType = z.enum(['album', 'ep', 'single', 'compilation', 'other'])
export type ReleaseType = z.infer<typeof ReleaseType>

export const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  album: t('Album'),
  ep: t('EP'),
  single: t('Single'),
  compilation: t('Compilation'),
  other: t('Sonstiges')
}

export const ReleaseFormat = z.enum(['digital', 'cd', 'vinyl', 'cassette', 'other'])
export type ReleaseFormat = z.infer<typeof ReleaseFormat>

export const RELEASE_FORMAT_LABELS: Record<ReleaseFormat, string> = {
  digital: t('Digital'),
  cd: t('CD'),
  vinyl: t('Vinyl'),
  cassette: t('Kassette'),
  other: t('Sonstiges')
}

/** The part someone has in the work behind a track (lyrics, music, arrangement) */
export const WorkRole = z.enum(['lyricist', 'composer', 'arranger', 'other'])
export type WorkRole = z.infer<typeof WorkRole>

export const WORK_ROLE_LABELS: Record<WorkRole, string> = {
  lyricist: t('Text'),
  composer: t('Musik'),
  arranger: t('Bearbeitung'),
  other: t('Sonstiges')
}

/** Suggestions for the free-text role of a contributor; label copies use many more */
export const CONTRIBUTOR_ROLE_SUGGESTIONS: readonly string[] = [
  'Primary Artist',
  'Featured Artist',
  'Producer',
  'Recording Engineer',
  'Mixing Engineer',
  'Mastering Engineer',
  'Photography',
  'Artwork',
  'Guest Musician'
]

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')
  .nullable()

const Text = z.string().trim().default('')
const Id = z.number().int().positive()

// ---------- Release ----------

export const ReleaseFields = z.object({
  /** The band of ours it belongs to; null for a release of someone else */
  bandId: Id.nullable().default(null),
  /** The artist as printed; empty means the band's name */
  artistName: Text,
  title: z.string().trim().min(1, 'Bitte einen Titel angeben'),
  version: Text,
  releaseType: ReleaseType.default('album'),
  releaseDate: IsoDate.default(null),
  /** For a re-issue: when it first came out */
  originalReleaseDate: IsoDate.default(null),
  preorderD2cDate: IsoDate.default(null),
  preorderRetailDate: IsoDate.default(null),
  preorderDigitalDate: IsoDate.default(null),
  /** The label as printed; empty means the name of the label's company */
  label: Text,
  /** The label as a company of the address book */
  labelCompanyId: Id.nullable().default(null),
  catalogNumber: Text,
  pLine: Text,
  cLine: Text,
  genre: Text,
  subGenre: Text,
  metadataLanguage: Text,
  recordingCountry: Text,
  projectNumber: Text,
  notes: Text
})
export type ReleaseFields = z.infer<typeof ReleaseFields>

export const CreateReleaseInput = ReleaseFields
export type CreateReleaseInput = z.infer<typeof CreateReleaseInput>

export const UpdateReleaseInput = ReleaseFields.extend({ id: Id })
export type UpdateReleaseInput = z.infer<typeof UpdateReleaseInput>

/** What the procedures accept before the defaults are filled in */
export type CreateReleaseRequest = z.input<typeof CreateReleaseInput>
export type UpdateReleaseRequest = z.input<typeof UpdateReleaseInput>

export const ReleaseDto = z
  .object({
    id: z.number(),
    bandId: z.number().nullable(),
    bandName: z.string().nullable(),
    /** artistName, or the band's name when it is empty */
    artist: z.string(),
    artistName: z.string(),
    title: z.string(),
    version: z.string(),
    releaseType: ReleaseType,
    releaseDate: z.string().nullable(),
    originalReleaseDate: z.string().nullable(),
    preorderD2cDate: z.string().nullable(),
    preorderRetailDate: z.string().nullable(),
    preorderDigitalDate: z.string().nullable(),
    label: z.string(),
    labelCompanyId: z.number().nullable(),
    labelCompanyName: z.string().nullable(),
    /** label, or the company's name when it is empty */
    labelShown: z.string(),
    catalogNumber: z.string(),
    pLine: z.string(),
    cLine: z.string(),
    genre: z.string(),
    subGenre: z.string(),
    metadataLanguage: z.string(),
    recordingCountry: z.string(),
    projectNumber: z.string(),
    notes: z.string(),
    productCount: z.number(),
    trackCount: z.number(),
    /** The products' codes, comma-separated, for the list */
    upcs: z.string()
  })
  .extend(TimestampFields.shape)
export type ReleaseDto = z.infer<typeof ReleaseDto>

export const PaginatedReleaseResponse = createPaginatedResponse(ReleaseDto)
export type PaginatedReleaseResponse = z.infer<typeof PaginatedReleaseResponse>

// ---------- Contributors and work shares ----------

export const ContributorInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben'),
  role: Text,
  instrument: Text,
  personId: Id.nullable().default(null)
})
export type ContributorInput = z.infer<typeof ContributorInput>

export const ContributorDto = z.object({
  id: z.number(),
  name: z.string(),
  role: z.string(),
  instrument: z.string(),
  personId: z.number().nullable()
})
export type ContributorDto = z.infer<typeof ContributorDto>

export const WorkShareInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben'),
  role: WorkRole.default('composer'),
  /** 0-100; null when the copy names the person without a share */
  sharePercent: z.number().min(0).max(100).nullable().default(null),
  society: Text,
  ipi: Text,
  publisher: Text,
  country: Text,
  personId: Id.nullable().default(null)
})
export type WorkShareInput = z.infer<typeof WorkShareInput>

export const WorkShareDto = z.object({
  id: z.number(),
  name: z.string(),
  role: WorkRole,
  sharePercent: z.number().nullable(),
  society: z.string(),
  ipi: z.string(),
  publisher: z.string(),
  country: z.string(),
  personId: z.number().nullable()
})
export type WorkShareDto = z.infer<typeof WorkShareDto>

/** The credits of the release as a whole (producer, mix, artwork …), replaced as one list */
export const SaveReleaseCreditsInput = z.object({
  releaseId: Id,
  contributors: z.array(ContributorInput)
})
export type SaveReleaseCreditsInput = z.infer<typeof SaveReleaseCreditsInput>

// ---------- Tracks ----------

export const SaveTrackInput = z.object({
  /** null creates the track */
  id: Id.nullable().default(null),
  releaseId: Id,
  title: z.string().trim().min(1, 'Bitte einen Titel angeben'),
  version: Text,
  durationSeconds: z.number().int().nonnegative().nullable().default(null),
  isrc: Text,
  explicit: z.boolean().default(false),
  genre: Text,
  pLine: Text,
  cLine: Text,
  videoIsrc: Text,
  lyrics: Text,
  notes: Text,
  contributors: z.array(ContributorInput).default([]),
  workShares: z.array(WorkShareInput).default([])
})
export type SaveTrackInput = z.input<typeof SaveTrackInput>
export type SaveTrackData = z.output<typeof SaveTrackInput>

export const TrackDto = z.object({
  id: z.number(),
  releaseId: z.number(),
  position: z.number(),
  title: z.string(),
  version: z.string(),
  durationSeconds: z.number().nullable(),
  isrc: z.string(),
  explicit: z.boolean(),
  genre: z.string(),
  pLine: z.string(),
  cLine: z.string(),
  videoIsrc: z.string(),
  lyrics: z.string(),
  notes: z.string(),
  contributors: z.array(ContributorDto),
  workShares: z.array(WorkShareDto)
})
export type TrackDto = z.infer<typeof TrackDto>

// ---------- Products ----------

export const ProductTrackInput = z.object({
  trackId: Id,
  disc: z.number().int().min(1).default(1),
  /** Vinyl side (A, B …); empty otherwise */
  side: Text
})
export type ProductTrackInput = z.infer<typeof ProductTrackInput>

export const SaveProductInput = z.object({
  id: Id.nullable().default(null),
  releaseId: Id,
  format: ReleaseFormat.default('digital'),
  /** What sets it apart: "Single Panic Stations", "Vinyl rot" …; may stay empty */
  title: Text,
  packaging: Text,
  color: Text,
  upc: Text,
  catalogNumber: Text,
  territory: Text,
  discCount: z.number().int().min(1).nullable().default(null),
  /** Its own date when it differs from the release (a single ahead of the album) */
  releaseDate: IsoDate.default(null),
  priceCode: Text,
  boxLot: z.number().int().min(1).nullable().default(null),
  notes: Text,
  /** The tracklist in order */
  tracks: z.array(ProductTrackInput).default([])
})
export type SaveProductInput = z.input<typeof SaveProductInput>
export type SaveProductData = z.output<typeof SaveProductInput>

export const ProductTrackDto = z.object({
  trackId: z.number(),
  position: z.number(),
  disc: z.number(),
  side: z.string()
})
export type ProductTrackDto = z.infer<typeof ProductTrackDto>

export const ProductDto = z.object({
  id: z.number(),
  releaseId: z.number(),
  position: z.number(),
  format: ReleaseFormat,
  title: z.string(),
  packaging: z.string(),
  color: z.string(),
  upc: z.string(),
  catalogNumber: z.string(),
  territory: z.string(),
  discCount: z.number().nullable(),
  releaseDate: z.string().nullable(),
  priceCode: z.string(),
  boxLot: z.number().nullable(),
  notes: z.string(),
  tracks: z.array(ProductTrackDto)
})
export type ProductDto = z.infer<typeof ProductDto>

// ---------- The whole release ----------

export const ReleaseDetailDto = ReleaseDto.extend({
  credits: z.array(ContributorDto),
  tracks: z.array(TrackDto),
  products: z.array(ProductDto)
})
export type ReleaseDetailDto = z.infer<typeof ReleaseDetailDto>

export const MoveTrackInput = z.object({
  id: Id,
  direction: z.enum(['up', 'down'])
})
export type MoveTrackInput = z.infer<typeof MoveTrackInput>
