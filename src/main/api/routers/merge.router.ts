import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { MergeService } from '../../services/MergeService'
import {
  MergeCandidatesInput,
  MergeInput,
  MergePairInput,
  type MergeCandidateDto,
  type MergePreviewDto
} from '../schemas/merge.schema'

const t = initTRPC.create()
const service = container.resolve(MergeService)

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

/** #249: merging two records of one kind */
export const mergeRouter = t.router({
  candidates: t.procedure
    .input(MergeCandidatesInput)
    .query(({ input }): MergeCandidateDto[] => service.candidates(input.kind, input.id)),

  preview: t.procedure.input(MergePairInput).query(({ input }): MergePreviewDto => {
    try {
      return service.preview(input)
    } catch (error) {
      throw badRequest(error, 'Vorschau nicht möglich')
    }
  }),

  merge: t.procedure.input(MergeInput).mutation(({ input }): { id: number } => {
    try {
      return { id: service.merge(input) }
    } catch (error) {
      throw badRequest(error, 'Zusammenführen fehlgeschlagen')
    }
  })
})
