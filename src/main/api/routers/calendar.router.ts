import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { CalendarFeedService } from '../../services/CalendarFeedService'
import { SettingsService } from '../../services/SettingsService'

const t = initTRPC.create()
const feed = container.resolve(CalendarFeedService)
const settings = container.resolve(SettingsService)

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

/** Save dialog for an .ics file; null if canceled */
async function askForIcsPath(title: string, fileName: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow()
  const options: Electron.SaveDialogOptions = {
    title,
    defaultPath: join(app.getPath('documents'), fileName),
    filters: [{ name: 'Kalender (iCalendar)', extensions: ['ics'] }]
  }
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export const calendarRouter = t.router({
  status: t.procedure.query(() => feed.status()),

  /** Picks the file to keep up to date and writes it right away */
  chooseFeedFile: t.procedure.mutation(async () => {
    const path = await askForIcsPath('Kalender-Datei festlegen', 'Bookingium.ics')
    if (!path) return feed.status()
    settings.update({ calendarFeedPath: path })
    return feed.update()
  }),

  /** Stops updating the file (the file itself stays) */
  disableFeed: t.procedure.mutation(() => {
    settings.update({ calendarFeedPath: '' })
    return feed.status()
  }),

  updateFeed: t.procedure.mutation(() => feed.update()),

  revealFeedFile: t.procedure.mutation(() => {
    const path = settings.get().calendarFeedPath
    if (path) shell.showItemInFolder(path)
  }),

  /** One-off .ics of all events (e.g. to import into Outlook once) */
  exportOnce: t.procedure.mutation(async () => {
    const path = await askForIcsPath('Kalender exportieren', 'Bookingium Events.ics')
    if (!path) return { canceled: true, path: null, events: 0 }
    try {
      const events = await feed.writeTo(path)
      shell.showItemInFolder(path)
      return { canceled: false, path, events }
    } catch (error) {
      throw badRequest(error, 'Export fehlgeschlagen')
    }
  })
})
