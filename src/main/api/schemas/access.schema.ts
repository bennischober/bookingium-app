import { z } from 'zod'

// ========================================
// Staff access (Mitarbeiterzugang, #262)
// ========================================

/** 4 to 12 digits; '' or null where the PIN is optional means none */
export const StaffPin = z.string().regex(/^\d{4,12}$/, 'Die PIN besteht aus 4 bis 12 Ziffern.')

export const EnableStaffAccessInput = z.object({ pin: StaffPin.nullable() })
export type EnableStaffAccessInput = z.infer<typeof EnableStaffAccessInput>

export const SetStaffPinInput = z.object({ pin: StaffPin.nullable() })
export type SetStaffPinInput = z.infer<typeof SetStaffPinInput>

// Any text: a wrong PIN is a wrong PIN, not a format error
export const UnlockStaffAccessInput = z.object({ pin: z.string().max(64) })
export type UnlockStaffAccessInput = z.infer<typeof UnlockStaffAccessInput>

export const AccessStatusDto = z.object({
  // This computer is switched to staff access
  staffMode: z.boolean(),
  // A PIN is needed to unlock
  hasPin: z.boolean(),
  // Staff access, but unlocked for this session
  unlocked: z.boolean(),
  // Staff access and locked: the internal areas are closed
  locked: z.boolean(),
  // Seconds until unlocking may be tried again after too many wrong PINs, 0 for now
  retryAfterSeconds: z.number().int().min(0)
})
export type AccessStatusDto = z.infer<typeof AccessStatusDto>
