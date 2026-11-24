import { z } from 'zod'

// ========================================
// Employees and what they see (#262)
// ========================================
// An employee works on a computer of their own that syncs through a folder of its own (the staff
// channel). One admin computer serves that folder (the bridge, src/main/staff): it writes only
// what the employee may see and takes the employee's changes back after checking them.
//
// What the employee sees follows src/main/staff/policy.ts. A grant overrides it per record:
// `shared` shows a record (and, for a band, its booking work), `internal` hides it. A grant
// without an employee applies to all of them.

/** The records a grant can name */
export const StaffGrantEntity = z.enum([
  'band',
  'deal_memo',
  'management_contract',
  'invoice',
  'event_settlement',
  'document',
  'receipt',
  'trip',
  // contacts: hidden unless shared or needed by a visible record
  'person',
  'company',
  'venue',
  'hotel',
  'contact_list'
])
export type StaffGrantEntity = z.infer<typeof StaffGrantEntity>

export const StaffGrantAccess = z.enum(['shared', 'internal'])
export type StaffGrantAccess = z.infer<typeof StaffGrantAccess>

export const EmployeeDto = z.object({
  id: z.number(),
  name: z.string(),
  // The employee's computer takes its ids from this range (sync/ids.ts): what it created
  idPrefix: z.number(),
  // The admin computer serving the employee's folder (its sync device id), '' for none yet
  bridgeDevice: z.string(),
  // This computer serves the folder
  bridgedHere: z.boolean(),
  // The folder, when this computer serves it
  folder: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  // When the employee's computer last wrote a change, null for never (only where bridged)
  lastChangeAt: z.string().nullable(),
  // The employee's computer joined the folder
  joined: z.boolean(),
  lastError: z.string().nullable()
})
export type EmployeeDto = z.infer<typeof EmployeeDto>

export const CreateEmployeeInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben.').max(100),
  folder: z.string().min(1)
})
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeInput>

export const StaffGrantTarget = z.object({ entity: StaffGrantEntity, entityId: z.number() })
export type StaffGrantTarget = z.infer<typeof StaffGrantTarget>

/** `default`: no grant, the record follows the rules (inherited or internal) */
export const StaffGrantChoice = z.enum(['default', 'shared', 'internal'])
export type StaffGrantChoice = z.infer<typeof StaffGrantChoice>

export const SetStaffGrantInput = StaffGrantTarget.extend({
  // null: every employee
  employeeId: z.number().nullable(),
  choice: StaffGrantChoice
})
export type SetStaffGrantInput = z.infer<typeof SetStaffGrantInput>

export const StaffGrantStateDto = z.object({
  // What applies to all employees
  all: StaffGrantChoice,
  employees: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      choice: StaffGrantChoice,
      // Whether the employee sees the record now, with every rule applied
      visible: z.boolean()
    })
  )
})
export type StaffGrantStateDto = z.infer<typeof StaffGrantStateDto>
