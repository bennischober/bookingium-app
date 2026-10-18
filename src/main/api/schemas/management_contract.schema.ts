import { z } from 'zod'
import { TimestampFields } from './base.schema'
import { ContractPartySchema } from './contract.schema'

// Management contract (management company <-> band). Terms default to the
// agency's contract draft; the legal text itself is fixed in the document.

export const ManagementContractDto = z
  .object({
    id: z.number(),
    bandId: z.number(),
    managementCompanyId: z.number().nullable(),
    startDate: z.string().nullable(),
    territory: z.string(),
    termYears: z.number(),
    renewalYears: z.number(),
    noticeMonths: z.number(),
    commissionPercent: z.number(),
    excludedIncome: z.string(),
    statementEmail: z.string(),
    settlementDays: z.number(),
    paymentDays: z.number(),
    postTermYear1Percent: z.number(),
    postTermYear2Percent: z.number(),
    postTermYear3Percent: z.number(),
    representativePersonId: z.number().nullable(),
    specialClauses: z.string(),
    // Members/shareholders named in the group clause
    memberPersonIds: z.array(z.number())
  })
  .extend(TimestampFields.shape)

export type ManagementContractDto = z.infer<typeof ManagementContractDto>

const wholeNumber = z.number().int().min(0)
const percent = z.number().min(0).max(100)

export const UpdateManagementContractInput = z.object({
  id: z.number(),
  managementCompanyId: z.number().nullable().optional(),
  startDate: z.string().nullable().optional(),
  territory: z.string().optional(),
  termYears: wholeNumber.optional(),
  renewalYears: wholeNumber.optional(),
  noticeMonths: wholeNumber.optional(),
  commissionPercent: percent.optional(),
  excludedIncome: z.string().optional(),
  statementEmail: z.string().optional(),
  settlementDays: wholeNumber.optional(),
  paymentDays: wholeNumber.optional(),
  postTermYear1Percent: percent.optional(),
  postTermYear2Percent: percent.optional(),
  postTermYear3Percent: percent.optional(),
  representativePersonId: z.number().nullable().optional(),
  specialClauses: z.string().optional(),
  memberPersonIds: z.array(z.number()).optional()
})

export type UpdateManagementContractInput = z.infer<typeof UpdateManagementContractInput>

const PrintPerson = z.object({
  personId: z.number(),
  name: z.string(),
  street: z.string(),
  streetNumber: z.string(),
  zipCode: z.string(),
  city: z.string()
})

export const ManagementContractPrintData = z.object({
  contract: ManagementContractDto,
  band: z.object({ id: z.number(), name: z.string() }),
  // MANAGEMENT and KÜNSTLER (the band's company) as contract parties
  management: ContractPartySchema.nullable(),
  managementLogoPath: z.string().nullable(),
  artist: ContractPartySchema.nullable(),
  members: z.array(PrintPerson),
  representative: PrintPerson.nullable()
})

export type ManagementContractPrintData = z.infer<typeof ManagementContractPrintData>
