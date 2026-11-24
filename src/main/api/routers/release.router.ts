import { z } from 'zod'
import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { ReleaseService } from '../../services/ReleaseService'
import {
  LabelCopyError,
  ReleaseImportService,
  type LabelCopyFile
} from '../../services/ReleaseImportService'
import { attachmentFileName, readSourceFile } from '../sourceFiles'
import {
  ApplyLabelCopyInput,
  PlanLabelCopyInput,
  type LabelCopyOrigin
} from '../schemas/release_import.schema'
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

/**
 * The label copy, read here so the service never touches a path it was not given: a picked
 * file, or a mail attachment straight from the mail worker under its stored name
 */
async function labelCopyFile(source: LabelCopyOrigin): Promise<LabelCopyFile> {
  const wrongType = 'Bitte eine Excel-Datei (.xlsx) oder PDF wählen.'
  const { bytes, fileName } = await readSourceFile(source, ['xlsx', 'pdf'], wrongType)
  if (source.kind === 'file') return { bytes, fileName, path: source.path, mail: null }
  const name = await attachmentFileName(source)
  if (!/\.(xlsx|pdf)$/i.test(name)) throw new TRPCError({ code: 'BAD_REQUEST', message: wrongType })
  return {
    bytes,
    fileName: name,
    path: null,
    mail: { accountId: source.accountId, messageId: source.storeMessageId ?? null }
  }
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

  listByLabelCompany: t.procedure.input(Id).query(async ({ input }) => {
    return ReleaseMapper.toDtoList(await releaseService.listByLabelCompany(input))
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
    const file = await labelCopyFile(input.source)
    return readable(() => importService.plan(file, input.releaseId))
  }),

  /** Merges the label copy into the release (or a new one) as confirmed in the preview */
  applyLabelCopy: t.procedure.input(ApplyLabelCopyInput).mutation(async ({ input }) => {
    const file = await labelCopyFile(input.source)
    return readable(() => importService.apply(file, input))
  })
})
