import { z } from 'zod'

// ========================================
// Band Member Schemas
// ========================================
export const BandMemberDto = z.object({
  id: z.number(),
  bandId: z.number(),
  bandName: z.string(),
  personId: z.number(),
  personName: z.string(),
  role: z.string(),
  notes: z.string()
})

export const CreateBandMemberInput = z.object({
  bandId: z.number(),
  personId: z.number(),
  role: z.string().min(1, 'Role is required'),
  notes: z.string().default('')
})

export const UpdateBandMemberInput = z.object({
  id: z.number(),
  role: z.string().min(1, 'Role is required').optional(),
  notes: z.string().optional()
})

// ========================================
// Company Member Schemas
// ========================================
export const CompanyMemberDto = z.object({
  id: z.number(),
  companyId: z.number(),
  companyName: z.string(),
  personId: z.number(),
  personName: z.string(),
  role: z.string(),
  notes: z.string()
})

export const CreateCompanyMemberInput = z.object({
  companyId: z.number(),
  personId: z.number(),
  role: z.string().min(1, 'Role is required'),
  notes: z.string().default('')
})

export const UpdateCompanyMemberInput = z.object({
  id: z.number(),
  role: z.string().min(1, 'Role is required').optional(),
  notes: z.string().optional()
})

// ========================================
// Venue Member Schemas
// ========================================
export const VenueMemberDto = z.object({
  id: z.number(),
  venueId: z.number(),
  venueName: z.string(),
  personId: z.number(),
  personName: z.string(),
  role: z.string(),
  notes: z.string()
})

export const CreateVenueMemberInput = z.object({
  venueId: z.number(),
  personId: z.number(),
  role: z.string().min(1, 'Role is required'),
  notes: z.string().default('')
})

export const UpdateVenueMemberInput = z.object({
  id: z.number(),
  role: z.string().min(1, 'Role is required').optional(),
  notes: z.string().optional()
})

// ========================================
// Person Relations Response
// ========================================
export const PersonRelationsDto = z.object({
  bands: z.array(BandMemberDto),
  companies: z.array(CompanyMemberDto),
  venues: z.array(VenueMemberDto)
})

// ========================================
// Delete Input (shared)
// ========================================
export const DeleteMemberInput = z.object({
  id: z.number()
})

// Type exports
export type BandMemberDto = z.infer<typeof BandMemberDto>
export type CreateBandMemberInput = z.infer<typeof CreateBandMemberInput>
export type UpdateBandMemberInput = z.infer<typeof UpdateBandMemberInput>

export type CompanyMemberDto = z.infer<typeof CompanyMemberDto>
export type CreateCompanyMemberInput = z.infer<typeof CreateCompanyMemberInput>
export type UpdateCompanyMemberInput = z.infer<typeof UpdateCompanyMemberInput>

export type VenueMemberDto = z.infer<typeof VenueMemberDto>
export type CreateVenueMemberInput = z.infer<typeof CreateVenueMemberInput>
export type UpdateVenueMemberInput = z.infer<typeof UpdateVenueMemberInput>

export type PersonRelationsDto = z.infer<typeof PersonRelationsDto>
export type DeleteMemberInput = z.infer<typeof DeleteMemberInput>
