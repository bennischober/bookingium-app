import { z } from 'zod'
import { roundMoney } from '../../einvoice/amounts'
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

// ========================================
// Quarterly management share ("Managementbeteiligung")
// ========================================

/** "4. Quartal 2025" – period label and invoice line wording */
export function quarterLabel(year: number, quarter: number): string {
  return `${quarter}. Quartal ${year}`
}

/** First and last day of a quarter as YYYY-MM-DD */
export function quarterDates(year: number, quarter: number): { start: string; end: string } {
  const firstMonth = (quarter - 1) * 3 + 1
  const lastMonth = firstMonth + 2
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    start: `${year}-${pad(firstMonth)}-01`,
    end: `${year}-${pad(lastMonth)}-${pad(lastDay)}`
  }
}

/** The management's net share: commission % of the band's net income, rounded to cents */
export function managementShareAmount(incomeTotal: number, commissionPercent: number): number {
  return roundMoney((incomeTotal * commissionPercent) / 100)
}

export const ManagementShareIncomeInput = z.object({
  description: z.string().trim().min(1, 'Bitte die Art der Einnahme angeben'),
  netAmount: z.number().min(0)
})

export type ManagementShareIncomeInput = z.infer<typeof ManagementShareIncomeInput>

export const CreateManagementShareInput = z.object({
  contractId: z.number(),
  year: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4),
  // The band's reported net income for the quarter, one line per kind
  income: z.array(ManagementShareIncomeInput).min(1),
  taxRate: percent.optional().default(19),
  issueDate: z.string().optional()
})

export type CreateManagementShareInput = z.infer<typeof CreateManagementShareInput>

export const ManagementShareDto = z.object({
  id: z.number(),
  invoiceId: z.number(),
  bandId: z.number(),
  managementContractId: z.number().nullable(),
  year: z.number(),
  quarter: z.number(),
  commissionPercent: z.number(),
  income: z.array(z.object({ description: z.string(), netAmount: z.number() })),
  incomeTotal: z.number(),
  // Net amount billed (the invoice's, so later edits to the draft show)
  netAmount: z.number(),
  invoiceNumber: z.number().nullable(),
  invoiceStatus: z.string(),
  createdAt: z.string()
})

export type ManagementShareDto = z.infer<typeof ManagementShareDto>
