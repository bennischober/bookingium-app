import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { atlasCsv } from '../../marketing/atlasCsv'
import type { ExportResultDto } from '../schemas/export.schema'
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
  UpdateMarketingItemsInput,
  LinkMarketingContactInput,
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

/** The band's atlas, its entries with their measures and candidates, and the undo state */
function overviewDto(bandId: number): MarketingOverviewDto {
  const { atlas, items, candidates, undo } = service.overview(bandId)
  const byItem = new Map<number, string[]>()
  for (const row of actionRepository.forItems(items.map((item) => item.id))) {
    if (row.itemId === null) continue
    byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row.status])
  }
  return {
    atlas: atlas ? MarketingMapper.toAtlasDto(atlas) : null,
    items: items.map((row) =>
      MarketingMapper.toItemDto(
        row,
        actionStatusOf(byItem.get(row.id) ?? []),
        candidates.get(row.id) ?? []
      )
    ),
    undo
  }
}

const linkDtos = (rows: ReturnType<MarketingService['linksOf']>): MarketingLinkDto[] =>
  rows.map((row) => ({
    ...row,
    category: row.category as MarketingCategory,
    priority: row.priority as MarketingPriority,
    status: row.status as MarketingStatus
  }))

/** Marketing-Atlas of a band */
export const marketingRouter = t.router({
  overview: t.procedure
    .input(z.number().int())
    .query(({ input }): MarketingOverviewDto => overviewDto(input)),

  /** The given entries of the band's list, in that order, as a CSV file (save dialog) */
  exportList: t.procedure
    .input(
      z.object({
        bandId: z.number().int().positive(),
        ids: z.array(z.number().int().positive()).min(1).max(20000)
      })
    )
    .mutation(async ({ input }): Promise<ExportResultDto> => {
      const byId = new Map(overviewDto(input.bandId).items.map((item) => [item.id, item]))
      const items = input.ids
        .map((id) => byId.get(id))
        .filter((item): item is MarketingItemDto => !!item)
      const band = service.bandName(input.bandId) ?? ''
      const owner = BrowserWindow.getFocusedWindow()
      const options: Electron.SaveDialogOptions = {
        title: 'Als CSV-Datei exportieren',
        defaultPath: join(
          app.getPath('documents'),
          `Marketing-Atlas ${band} ${new Date().toISOString().slice(0, 10)}.csv`.replace(
            /[\\/:*?"<>|]/g,
            '-'
          )
        ),
        filters: [{ name: 'CSV-Datei', extensions: ['csv'] }]
      }
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { canceled: true, filePath: null, rows: 0 }
      try {
        await writeFile(result.filePath, atlasCsv(items, app.getSystemLocale() || 'de-DE'), 'utf-8')
      } catch (error) {
        throw badRequest(error, 'Export fehlgeschlagen')
      }
      return { canceled: false, filePath: result.filePath, rows: items.length }
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

  /** One status for several entries (Mehrfachauswahl) */
  updateMany: t.procedure.input(UpdateMarketingItemsInput).mutation(({ input }) => {
    try {
      return { changed: service.updateMany(input) }
    } catch (error) {
      throw badRequest(error, 'Nicht gespeichert')
    }
  }),

  /** Takes the band's last atlas import back (on the computer that ran it) */
  undoImport: t.procedure.input(z.number().int().positive()).mutation(({ input }) => {
    try {
      return service.undoImport(input)
    } catch (error) {
      throw badRequest(error, 'Import nicht zurückgenommen')
    }
  }),

  /** Links an entry to the given company/venue, or creates/finds one by name */
  linkContact: t.procedure.input(LinkMarketingContactInput).mutation(({ input }) => {
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
