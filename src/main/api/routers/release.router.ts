import { z } from 'zod'
import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { ReleaseService } from '../../services/ReleaseService'
import {
  LabelCopyError,
  ReleaseImportService,
  type LabelCopyFile
} from '../../services/ReleaseImportService'
import { readSourceFile } from '../sourceFiles'
import { ApplyLabelCopyInput, PlanLabelCopyInput } from '../schemas/release_import.schema'
import { ReleaseMapper } from '../mappers/release.mapper'
import { PaginationInput } from '../schemas/base.schema'
import {
  CreateReleaseInput,
  MoveTrackInput,
  SaveProductInput,
  SaveReleaseCreditsInput,
  SaveTrackInput,
  UpdateReleaseInput
} from '../schemas/release.schema'

const t = initTRPC.create()
const releaseService = container.resolve(ReleaseService)
const importService = container.resolve(ReleaseImportService)

/** The picked label copy, read here so the service never touches a path it was not given */
async function labelCopyFile(path: string): Promise<LabelCopyFile> {
  const { bytes, fileName } = await readSourceFile(
    { kind: 'file', path },
    ['xlsx', 'pdf'],
    'Bitte eine Excel-Datei (.xlsx) oder PDF wählen.'
  )
  return { bytes, fileName, path }
}

/** A file the import cannot read is the user's input, not a server fault */
async function readable<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof LabelCopyError)
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
    throw error
  }
}

const Id = z.number().int().positive()

/** Releases (#289). Every change answers with the whole release, so the page shows it at once. */
export const releaseRouter = t.router({
  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await releaseService.getAllPaginated(input)
    return { ...result, items: ReleaseMapper.toDtoList(result.items) }
  }),

  /** Every release, for pickers (the import's target, a measure's release) */
  listAll: t.procedure.query(async () => ReleaseMapper.toDtoList(await releaseService.listAll())),

  listByBand: t.procedure.input(Id).query(async ({ input }) => {
    return ReleaseMapper.toDtoList(await releaseService.listByBand(input))
  }),

  getById: t.procedure.input(Id).query(async ({ input }) => {
    const release = await releaseService.getDetail(input)
    if (!release) throw new TRPCError({ code: 'NOT_FOUND', message: 'Release nicht gefunden' })
    return ReleaseMapper.toDetailDto(release)
  }),

  create: t.procedure.input(CreateReleaseInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.create(input))
  }),

  update: t.procedure.input(UpdateReleaseInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.update(input))
  }),

  delete: t.procedure.input(Id).mutation(async ({ input }) => {
    await releaseService.delete(input)
  }),

  saveCredits: t.procedure.input(SaveReleaseCreditsInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.saveCredits(input))
  }),

  saveTrack: t.procedure.input(SaveTrackInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.saveTrack(input))
  }),

  deleteTrack: t.procedure.input(Id).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.deleteTrack(input))
  }),

  moveTrack: t.procedure.input(MoveTrackInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.moveTrack(input))
  }),

  saveProduct: t.procedure.input(SaveProductInput).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.saveProduct(input))
  }),

  deleteProduct: t.procedure.input(Id).mutation(async ({ input }) => {
    return ReleaseMapper.toDetailDto(await releaseService.deleteProduct(input))
  }),

  /** #289: what a label copy would change; a mutation, as it reads a file */
  planLabelCopy: t.procedure.input(PlanLabelCopyInput).mutation(async ({ input }) => {
    const file = await labelCopyFile(input.path)
    return readable(() => importService.plan(file, input.releaseId))
  }),

  /** Merges the label copy into the release (or a new one) as confirmed in the preview */
  applyLabelCopy: t.procedure.input(ApplyLabelCopyInput).mutation(async ({ input }) => {
    const file = await labelCopyFile(input.path)
    return readable(() => importService.apply(file, input))
  })
})
