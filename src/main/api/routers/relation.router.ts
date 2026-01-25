import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { RelationService } from '../../services/RelationService'
import { RelationMapper } from '../mappers/relation.mapper'
import {
  CreateBandMemberInput,
  UpdateBandMemberInput,
  CreateCompanyMemberInput,
  UpdateCompanyMemberInput,
  CreateVenueMemberInput,
  UpdateVenueMemberInput,
  DeleteMemberInput
} from '../schemas/relation.schema'

const t = initTRPC.create()
const relationService = container.resolve(RelationService)

export const relationRouter = t.router({
  // ========================================
  // Person Relations
  // ========================================
  getPersonRelations: t.procedure
    .input(z.object({ personId: z.number() }))
    .query(async ({ input }) => {
      const relations = await relationService.getPersonRelations(input.personId)
      return RelationMapper.toPersonRelationsDto(relations)
    }),

  // ========================================
  // Band Member Operations
  // ========================================
  getBandMembers: t.procedure.input(z.object({ bandId: z.number() })).query(async ({ input }) => {
    const members = await relationService.getBandMembers(input.bandId)
    return RelationMapper.toBandMemberDtoList(members)
  }),

  addBandMember: t.procedure.input(CreateBandMemberInput).mutation(async ({ input }) => {
    const member = await relationService.addBandMember(input)
    return RelationMapper.toBandMemberDto(member)
  }),

  updateBandMember: t.procedure.input(UpdateBandMemberInput).mutation(async ({ input }) => {
    const member = await relationService.updateBandMember(input)
    return RelationMapper.toBandMemberDto(member)
  }),

  removeBandMember: t.procedure.input(DeleteMemberInput).mutation(async ({ input }) => {
    await relationService.removeBandMember(input.id)
  }),

  // ========================================
  // Company Member Operations
  // ========================================
  getCompanyMembers: t.procedure
    .input(z.object({ companyId: z.number() }))
    .query(async ({ input }) => {
      const members = await relationService.getCompanyMembers(input.companyId)
      return RelationMapper.toCompanyMemberDtoList(members)
    }),

  addCompanyMember: t.procedure.input(CreateCompanyMemberInput).mutation(async ({ input }) => {
    const member = await relationService.addCompanyMember(input)
    return RelationMapper.toCompanyMemberDto(member)
  }),

  updateCompanyMember: t.procedure.input(UpdateCompanyMemberInput).mutation(async ({ input }) => {
    const member = await relationService.updateCompanyMember(input)
    return RelationMapper.toCompanyMemberDto(member)
  }),

  removeCompanyMember: t.procedure.input(DeleteMemberInput).mutation(async ({ input }) => {
    await relationService.removeCompanyMember(input.id)
  }),

  // ========================================
  // Venue Member Operations
  // ========================================
  getVenueMembers: t.procedure.input(z.object({ venueId: z.number() })).query(async ({ input }) => {
    const members = await relationService.getVenueMembers(input.venueId)
    return RelationMapper.toVenueMemberDtoList(members)
  }),

  addVenueMember: t.procedure.input(CreateVenueMemberInput).mutation(async ({ input }) => {
    const member = await relationService.addVenueMember(input)
    return RelationMapper.toVenueMemberDto(member)
  }),

  updateVenueMember: t.procedure.input(UpdateVenueMemberInput).mutation(async ({ input }) => {
    const member = await relationService.updateVenueMember(input)
    return RelationMapper.toVenueMemberDto(member)
  }),

  removeVenueMember: t.procedure.input(DeleteMemberInput).mutation(async ({ input }) => {
    await relationService.removeVenueMember(input.id)
  })
})
