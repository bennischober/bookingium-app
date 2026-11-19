import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog } from 'electron'
import { MarketingService } from '../../services/MarketingService'
import { MarketingMapper } from '../mappers/marketing.mapper'
import {
  MarketingImportInput,
  UpdateMarketingItemInput,
  type MarketingCategory,
  type MarketingFileDto,
  type MarketingImportResultDto,
  type MarketingLinkDto,
  type MarketingOverviewDto,
  type MarketingPriority,
  type MarketingStatus
} from '../schemas/marketing.schema'

const t = initTRPC.create()
const service = container.resolve(MarketingService)

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

const linkDtos = (rows: ReturnType<MarketingService['linksOf']>): MarketingLinkDto[] =>
  rows.map((row) => ({
    ...row,
    category: row.category as MarketingCategory,
    priority: row.priority as MarketingPriority,
    status: row.status as MarketingStatus
  }))

/** Marketing-Atlas of a band */
export const marketingRouter = t.router({
  overview: t.procedure.input(z.number().int()).query(({ input }): MarketingOverviewDto => {
    const { atlas, items } = service.overview(input)
    return {
      atlas: atlas ? MarketingMapper.toAtlasDto(atlas) : null,
      items: items.map((row) => MarketingMapper.toItemDto(row))
    }
  }),

  /** Asks for an atlas file and says what it holds; null when the dialog was cancelled */
  pickAtlas: t.procedure.mutation(async (): Promise<MarketingFileDto | null> => {
    const owner = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Marketing-Atlas wählen',
      defaultPath: app.getPath('documents'),
      filters: [{ name: 'Marketing-Atlas', extensions: ['json', 'html', 'htm'] }],
      properties: ['openFile']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      return await service.inspect(result.filePaths[0])
    } catch (error) {
      throw badRequest(error, 'Die Datei ist kein Marketing-Atlas')
    }
  }),

  importAtlas: t.procedure
    .input(MarketingImportInput)
    .mutation(async ({ input }): Promise<MarketingImportResultDto> => {
      try {
        return await service.importAtlas(input)
      } catch (error) {
        throw badRequest(error, 'Import fehlgeschlagen')
      }
    }),

  update: t.procedure.input(UpdateMarketingItemInput).mutation(({ input }) => {
    try {
      service.update(input)
    } catch (error) {
      throw badRequest(error, 'Nicht gespeichert')
    }
  }),

  /** Creates or finds the company/venue of an entry and links it */
  linkContact: t.procedure.input(z.number().int()).mutation(({ input }) => {
    try {
      service.linkContact(input)
    } catch (error) {
      throw badRequest(error, 'Kontakt konnte nicht angelegt werden')
    }
  }),

  forCompany: t.procedure
    .input(z.number().int())
    .query(({ input }): MarketingLinkDto[] => linkDtos(service.linksOf({ companyId: input }))),

  forVenue: t.procedure
    .input(z.number().int())
    .query(({ input }): MarketingLinkDto[] => linkDtos(service.linksOf({ venueId: input })))
})
