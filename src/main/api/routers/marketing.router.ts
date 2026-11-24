import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog } from 'electron'
import { MarketingService } from '../../services/MarketingService'
import { MarketingActionService } from '../../services/MarketingActionService'
import { MarketingActionRepository } from '../../repositories/MarketingActionRepository'
import { MarketingMapper } from '../mappers/marketing.mapper'
import {
  CreateMarketingActionInput,
  MarketingActionInvoiceInput,
  MarketingActionScope,
  UpdateMarketingActionInput,
  type MarketingActionDto,
  type MarketingItemDto,
  MarketingImportInput,
  SetMarketingPickedInput,
  UpdateMarketingItemInput,
  type SetMarketingPickedResultDto,
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
const actions = container.resolve(MarketingActionService)
const actionRepository = container.resolve(MarketingActionRepository)

/** Of an entry's measures the furthest one counts: running before booked before planned before done */
const ACTION_RANK = { running: 4, booked: 3, planned: 2, done: 1 } as const
function actionStatusOf(statuses: string[]): MarketingItemDto['actionStatus'] {
  let best: MarketingItemDto['actionStatus'] = null
  for (const status of statuses) {
    if (!(status in ACTION_RANK)) continue
    const s = status as keyof typeof ACTION_RANK
    if (best === null || ACTION_RANK[s] > ACTION_RANK[best]) best = s
  }
  return best
}

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
    const byItem = new Map<number, string[]>()
    for (const row of actionRepository.forItems(items.map((item) => item.id))) {
      if (row.itemId === null) continue
      byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row.status])
    }
    return {
      atlas: atlas ? MarketingMapper.toAtlasDto(atlas) : null,
      items: items.map((row) =>
        MarketingMapper.toItemDto(row, actionStatusOf(byItem.get(row.id) ?? []))
      )
    }
  }),

  /** Asks for an atlas file and says what it holds; null when the dialog was cancelled */
  pickAtlas: t.procedure
    .input(z.number().int().positive())
    .mutation(async ({ input: bandId }): Promise<MarketingFileDto | null> => {
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
        return await service.inspect(bandId, result.filePaths[0])
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

  /** Moves entries between the working list and the pool of the atlas */
  setPicked: t.procedure
    .input(SetMarketingPickedInput)
    .mutation(({ input }): SetMarketingPickedResultDto => {
      try {
        return service.setPicked(input)
      } catch (error) {
        throw badRequest(error, 'Nicht gespeichert')
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

  // ---- Maßnahmen ----
  actions: t.procedure
    .input(MarketingActionScope)
    .query(({ input }): MarketingActionDto[] => actions.list(input)),

  createAction: t.procedure.input(CreateMarketingActionInput).mutation(({ input }) => {
    try {
      return { id: actions.create(input) }
    } catch (error) {
      throw badRequest(error, 'Maßnahme nicht gespeichert')
    }
  }),

  updateAction: t.procedure.input(UpdateMarketingActionInput).mutation(({ input }) => {
    const { id, ...fields } = input
    try {
      actions.update(id, fields)
    } catch (error) {
      throw badRequest(error, 'Maßnahme nicht gespeichert')
    }
  }),

  deleteAction: t.procedure.input(z.number().int()).mutation(({ input }) => {
    actions.delete(input)
  }),

  /** "Rechnung erstellen": a draft invoice for the measure's cost; returns its id */
  createActionInvoice: t.procedure
    .input(MarketingActionInvoiceInput)
    .mutation(async ({ input }) => {
      try {
        return { invoiceId: await actions.createInvoice(input) }
      } catch (error) {
        throw badRequest(error, 'Rechnung konnte nicht erstellt werden')
      }
    }),

  forCompany: t.procedure
    .input(z.number().int())
    .query(({ input }): MarketingLinkDto[] => linkDtos(service.linksOf({ companyId: input }))),

  forVenue: t.procedure
    .input(z.number().int())
    .query(({ input }): MarketingLinkDto[] => linkDtos(service.linksOf({ venueId: input })))
})
