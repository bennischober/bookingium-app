import { z } from 'zod'
import { TimestampFields } from './base.schema'
import { ContractPartySchema } from './contract.schema'

// ========================================
// Publishing and label agreements of a band
// ========================================

// Two more contracts a band signs, printed from blank templates the user provided: a
// publishing contract (author <-> publisher, from the model publishing agreement, German and
// English) and a label "head of agreement" (owner <-> licensee, English template). The legal
// text is fixed in the documents; a record keeps the counterparty and the terms, stored as
// JSON per kind so a template's options need no migration.

export const BandAgreementKind = z.enum(['publishing', 'label'])
export type BandAgreementKind = z.infer<typeof BandAgreementKind>

const money = z.number().min(0).nullable()
const count = z.number().int().min(0)
const percent = z.number().min(0).max(100)

/** A contractual work (annex A of the publishing contract) */
export const PublishingWork = z.object({
  title: z.string().default(''),
  composer: z.string().default(''),
  lyricist: z.string().default(''),
  publisherShare: z.string().default('')
})
export type PublishingWork = z.infer<typeof PublishingWork>

export const PublishingTerms = z.object({
  /** The AUTHOR's collecting society membership number */
  authorGemaNumber: z.string().default(''),
  /** Publisher designation the works are registered with */
  publisherImprint: z.string().default(''),
  /** Rights for the statutory protection period, or for a number of years from release */
  rightsTerm: z.enum(['statutory', 'years']).default('statutory'),
  rightsYears: count.default(25),
  /** Unknown types of use: paid in proportion, or terms agreed later at market rates */
  unknownUses: z.enum(['proportional', 'market']).default('proportional'),
  printSinglePercent: percent.default(10),
  printAlbumPercent: percent.default(10),
  otherLicensePercent: percent.default(50),
  statementEmail: z.string().default(''),
  confidentialityYears: count.default(3),
  works: z.array(PublishingWork).default([]),
  /** Annex B: exclusive term with options, loan payment, minimum delivery, refund */
  exclusive: z.boolean().default(false),
  exclusiveStart: z.string().nullable().default(null),
  exclusiveEnd: z.string().nullable().default(null),
  options: count.default(1),
  advance: money.default(null),
  optionAdvancePercent: percent.nullable().default(null),
  optionAdvanceMin: money.default(null),
  optionAdvanceMax: money.default(null),
  rollingAdvance: money.default(null),
  minWorksTerm: count.nullable().default(null),
  minWorksOption: count.nullable().default(null),
  refundPercent: percent.nullable().default(null)
})
export type PublishingTerms = z.infer<typeof PublishingTerms>

/** "1-4,999 sold copies of the previous album: € 5,000" */
export const LabelAdvanceTier = z.object({
  fromCopies: count.default(0),
  amount: z.number().min(0).default(0)
})
export type LabelAdvanceTier = z.infer<typeof LabelAdvanceTier>

/** A royalty rate from a sales threshold on (0 = from the first sale) */
export const LabelRoyaltyTier = z.object({
  from: count.default(0),
  percent: percent.default(0)
})
export type LabelRoyaltyTier = z.infer<typeof LabelRoyaltyTier>

export const LabelTerms = z.object({
  rights: z.string().default('Exclusive physical and digital exploitation'),
  territory: z.string().default('World'),
  titleExclusivity: z.string().default(''),
  exploitationTime: z.string().default(''),
  /** What the term covers, e.g. one new studio album */
  term: z
    .string()
    .default(
      '1 new studio album (min. 90% of the songs written and performed by the Owner and previously unreleased)'
    ),
  albumOptions: count.default(1),
  optionAdvances: z.array(LabelAdvanceTier).default([]),
  physicalRoyalties: z.array(LabelRoyaltyTier).default([]),
  digitalRoyalties: z.array(LabelRoyaltyTier).default([]),
  packagingDeduction: z
    .string()
    .default(
      '0% for jewel case CDs / 10% for CD digipak and LP sleeve / 15% for gatefold, trifold, shape, liquid and box sets'
    ),
  sublicensingPercent: percent.default(50),
  accountingMonths: count.default(6),
  accountingDays: count.default(90),
  returnsReservePercent: percent.default(25),
  freeCopies: z
    .string()
    .default(
      '25 copies of every non-limited configuration; 1 copy of each other limited configuration for each band member, plus shipping and packaging'
    ),
  /** The Owner's purchase prices for CDs and vinyl, one per line */
  artistPrices: z.string().default(''),
  /** Optional merchandise deal, as typed */
  merchandise: z.string().default(''),
  offerOnlineStore: z.boolean().default(false),
  offerPublishing: z.boolean().default(false)
})
export type LabelTerms = z.infer<typeof LabelTerms>

/** The terms of a kind, with every missing field at its default */
export function parseAgreementTerms(kind: 'publishing', json: unknown): PublishingTerms
export function parseAgreementTerms(kind: 'label', json: unknown): LabelTerms
export function parseAgreementTerms(
  kind: BandAgreementKind,
  json: unknown
): PublishingTerms | LabelTerms
export function parseAgreementTerms(
  kind: BandAgreementKind,
  json: unknown
): PublishingTerms | LabelTerms {
  const value = typeof json === 'string' ? safeJson(json) : json
  const schema = kind === 'publishing' ? PublishingTerms : LabelTerms
  const parsed = schema.safeParse(value ?? {})
  return parsed.success ? parsed.data : schema.parse({})
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

const AgreementBase = z
  .object({
    id: z.number(),
    bandId: z.number(),
    /** Publisher or label */
    companyId: z.number().nullable(),
    startDate: z.string().nullable(),
    specialClauses: z.string()
  })
  .extend(TimestampFields.shape)

export const BandAgreementDto = z.discriminatedUnion('kind', [
  AgreementBase.extend({ kind: z.literal('publishing'), terms: PublishingTerms }),
  AgreementBase.extend({ kind: z.literal('label'), terms: LabelTerms })
])
export type BandAgreementDto = z.infer<typeof BandAgreementDto>

export const CreateBandAgreementInput = z.object({
  bandId: z.number(),
  kind: BandAgreementKind
})
export type CreateBandAgreementInput = z.infer<typeof CreateBandAgreementInput>

export const UpdateBandAgreementInput = z.object({
  id: z.number(),
  companyId: z.number().nullable().optional(),
  startDate: z.string().nullable().optional(),
  specialClauses: z.string().optional(),
  /** Checked against the record's kind in the repository */
  terms: z.record(z.string(), z.unknown()).optional()
})
export type UpdateBandAgreementInput = z.infer<typeof UpdateBandAgreementInput>

export const BandAgreementPrintData = z.object({
  agreement: BandAgreementDto,
  band: z.object({ id: z.number(), name: z.string() }),
  /** The band's company: AUTHOR or Owner */
  artist: ContractPartySchema.nullable(),
  /** Publisher or label */
  company: ContractPartySchema.nullable(),
  companyLogoPath: z.string().nullable()
})
export type BandAgreementPrintData = z.infer<typeof BandAgreementPrintData>
