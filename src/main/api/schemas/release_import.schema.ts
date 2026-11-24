import { z } from 'zod'
import { t } from '../../i18n/translate'
import { MarketingActionKind } from './marketing.schema'
import { ContributorInput, ReleaseFormat, ReleaseType, WorkShareInput } from './release.schema'

// ========================================
// Label copy import (#289): what a file holds, and how it lands in a release
// ========================================

export const LabelCopySource = z.enum(['excel', 'openplay'])
export type LabelCopySource = z.infer<typeof LabelCopySource>

export const LABEL_COPY_SOURCE_LABELS: Record<LabelCopySource, string> = {
  excel: t('Excel-Labelcopy'),
  openplay: t('Labelcopy-Report (OpenPlay)')
}

/** The head of a release as a label copy states it; empty text or null = not stated */
export const ParsedReleaseHead = z.object({
  artistName: z.string(),
  title: z.string(),
  version: z.string(),
  releaseType: ReleaseType.nullable(),
  releaseDate: z.string().nullable(),
  originalReleaseDate: z.string().nullable(),
  preorderD2cDate: z.string().nullable(),
  preorderRetailDate: z.string().nullable(),
  preorderDigitalDate: z.string().nullable(),
  label: z.string(),
  catalogNumber: z.string(),
  pLine: z.string(),
  cLine: z.string(),
  genre: z.string(),
  subGenre: z.string(),
  metadataLanguage: z.string(),
  recordingCountry: z.string(),
  projectNumber: z.string()
})
export type ParsedReleaseHead = z.infer<typeof ParsedReleaseHead>

export const ParsedTrack = z.object({
  /** "isrc:DE…" or "title:…": how products and later imports find the track */
  key: z.string(),
  title: z.string(),
  version: z.string(),
  durationSeconds: z.number().nullable(),
  isrc: z.string(),
  explicit: z.boolean().nullable(),
  genre: z.string(),
  pLine: z.string(),
  cLine: z.string(),
  videoIsrc: z.string(),
  lyrics: z.string(),
  contributors: z.array(ContributorInput),
  workShares: z.array(WorkShareInput)
})
export type ParsedTrack = z.infer<typeof ParsedTrack>

export const ParsedProduct = z.object({
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
  tracks: z.array(z.object({ trackKey: z.string(), disc: z.number(), side: z.string() }))
})
export type ParsedProduct = z.infer<typeof ParsedProduct>

export const BudgetSection = z.enum(['print', 'digital', 'pr'])
export type BudgetSection = z.infer<typeof BudgetSection>

/** A planned measure from the label's budget sheet; the label pays it */
export const ParsedBudgetLine = z.object({
  section: BudgetSection,
  kind: MarketingActionKind,
  title: z.string(),
  costCents: z.number().nullable(),
  done: z.boolean(),
  notes: z.string()
})
export type ParsedBudgetLine = z.infer<typeof ParsedBudgetLine>

export const ParsedLabelCopy = z.object({
  source: LabelCopySource,
  head: ParsedReleaseHead,
  credits: z.array(ContributorInput),
  tracks: z.array(ParsedTrack),
  products: z.array(ParsedProduct),
  budget: z.array(ParsedBudgetLine),
  /** What the reader had to guess, shown in the preview */
  warnings: z.array(z.string())
})
export type ParsedLabelCopy = z.infer<typeof ParsedLabelCopy>

// ---------- The preview ----------

/** new: not in the release yet; fill: fills empty fields only; conflict: differs; same: nothing to do */
export const ImportStatus = z.enum(['new', 'fill', 'conflict', 'same'])
export type ImportStatus = z.infer<typeof ImportStatus>

export const HeadFieldPlan = z.object({
  field: z.string(),
  label: z.string(),
  current: z.string(),
  incoming: z.string(),
  status: ImportStatus
})
export type HeadFieldPlan = z.infer<typeof HeadFieldPlan>

export const RowPlan = z.object({
  key: z.string(),
  label: z.string(),
  detail: z.string(),
  status: ImportStatus,
  /** The fields that differ (labels), for a conflict */
  conflicts: z.array(z.string())
})
export type RowPlan = z.infer<typeof RowPlan>

export const BudgetLinePlan = ParsedBudgetLine.extend({
  index: z.number(),
  /** Already a measure of this release (same kind and title) */
  exists: z.boolean()
})
export type BudgetLinePlan = z.infer<typeof BudgetLinePlan>

export const LabelCopyPlanDto = z.object({
  fileName: z.string(),
  source: LabelCopySource,
  /** The release it goes into; null = a new one */
  releaseId: z.number().nullable(),
  releaseTitle: z.string().nullable(),
  /** How that release was found by itself: "UPC 4006…", null when chosen or new */
  matchedBy: z.string().nullable(),
  /** The band whose name is the label copy's artist, for a new release */
  suggestedBandId: z.number().nullable(),
  head: z.array(HeadFieldPlan),
  tracks: z.array(RowPlan),
  products: z.array(RowPlan),
  credits: z.object({ incoming: z.number(), added: z.number() }),
  budget: z.array(BudgetLinePlan),
  /** The release has a band (marketing measures need one) */
  canImportBudget: z.boolean(),
  warnings: z.array(z.string())
})
export type LabelCopyPlanDto = z.infer<typeof LabelCopyPlanDto>

// ---------- Inputs ----------

/** Where the label copy comes from: a picked or dropped file, or a mail attachment */
export const LabelCopyOrigin = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().min(1) }),
  z.object({
    kind: z.literal('attachment'),
    accountId: z.string().min(1),
    messageId: z.number().int().positive(),
    partId: z.string().min(1),
    /** the mail's Message-ID header, kept with the stored document */
    storeMessageId: z.string().nullable().optional()
  })
])
export type LabelCopyOrigin = z.infer<typeof LabelCopyOrigin>

export const PlanLabelCopyInput = z.object({
  source: LabelCopyOrigin,
  /** undefined: find the release by its codes; null: a new release; a number: that release */
  releaseId: z.number().int().positive().nullable().optional()
})
export type PlanLabelCopyInput = z.infer<typeof PlanLabelCopyInput>

export const ApplyLabelCopyInput = z.object({
  source: LabelCopyOrigin,
  releaseId: z.number().int().positive().nullable(),
  /** For a new release */
  bandId: z.number().int().positive().nullable().default(null),
  /** Head fields whose differing value from the file replaces the release's */
  takeFields: z.array(z.string()).default([]),
  /** Differing values of matched tracks and products: the file's win */
  overwrite: z.boolean().default(false),
  /** The budget lines (index) that become marketing measures */
  budget: z.array(z.number().int().nonnegative()).default([])
})
export type ApplyLabelCopyInput = z.input<typeof ApplyLabelCopyInput>
export type ApplyLabelCopyData = z.output<typeof ApplyLabelCopyInput>

export const ApplyLabelCopyResult = z.object({
  releaseId: z.number(),
  created: z.boolean(),
  tracksAdded: z.number(),
  tracksUpdated: z.number(),
  productsAdded: z.number(),
  productsUpdated: z.number(),
  measuresAdded: z.number(),
  documentStored: z.boolean()
})
export type ApplyLabelCopyResult = z.infer<typeof ApplyLabelCopyResult>
