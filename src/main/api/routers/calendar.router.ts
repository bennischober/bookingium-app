import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import { container } from 'tsyringe'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { CalendarFeedService } from '../../services/CalendarFeedService'
import { SettingsService } from '../../services/SettingsService'
import { CalendarSubscriptionService } from '../../services/CalendarSubscriptionService'
import {
  CreateCalendarSubscriptionInput,
  SubscribedEntriesInput,
  UpdateCalendarSubscriptionInput
} from '../schemas/calendar_subscription.schema'

const t = initTRPC.create()
const feed = container.resolve(CalendarFeedService)
const settings = container.resolve(SettingsService)
const subscriptions = container.resolve(CalendarSubscriptionService)

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
    // #53: a share link belongs to the file it was made for
    const previous = settings.get().calendarFeedPath
    settings.update(
      previous && previous !== path
        ? { calendarFeedPath: path, calendarFeedShareUrl: '' }
        : { calendarFeedPath: path }
    )
    return feed.update()
  }),

  /** Stops updating the file (the file itself stays) */
  disableFeed: t.procedure.mutation(() => {
    settings.update({ calendarFeedPath: '', calendarFeedShareUrl: '' })
    return feed.status()
  }),

  updateFeed: t.procedure.mutation(() => feed.update()),

  /** #52: open follow-ups in the file or not; rewrites it at once */
  setFeedFollowUps: t.procedure.input(z.boolean()).mutation(({ input }) => {
    settings.update({ calendarFeedFollowUps: input })
    return feed.update()
  }),

  /** #71: own appointments in the file or not (off by default); rewrites it at once */
  setFeedAppointments: t.procedure.input(z.boolean()).mutation(({ input }) => {
    settings.update({ calendarFeedAppointments: input })
    return feed.update()
  }),

  revealFeedFile: t.procedure.mutation(() => {
    const path = settings.get().calendarFeedPath
    if (path) shell.showItemInFolder(path)
  }),

  /** One-off .ics of all events (e.g. to import into Outlook once) */
  exportOnce: t.procedure.mutation(async () => {
    const path = await askForIcsPath('Kalender exportieren', 'Bookingium Events.ics')
    if (!path) return { canceled: true, path: null, events: 0, followUps: 0, appointments: 0 }
    try {
      const { events, followUps, appointments } = await feed.writeTo(path)
      shell.showItemInFolder(path)
      return { canceled: false, path, events, followUps, appointments }
    } catch (error) {
      throw badRequest(error, 'Export fehlgeschlagen')
    }
  }),

  /** #53: checks the share link of the file and keeps it */
  checkShareLink: t.procedure
    .input(z.string().trim().min(1).max(2000))
    .mutation(async ({ input }) => {
      try {
        return await feed.checkShareLink(input)
      } catch (error) {
        throw badRequest(error, 'Link konnte nicht geprüft werden')
      }
    }),

  clearShareLink: t.procedure.mutation(() => feed.clearShareLink()),

  // #53: calendars subscribed by address
  listSubscriptions: t.procedure.query(() => subscriptions.list()),

  addSubscription: t.procedure
    .input(CreateCalendarSubscriptionInput)
    .mutation(async ({ input }) => {
      try {
        return await subscriptions.create(input)
      } catch (error) {
        throw badRequest(error, 'Kalender konnte nicht abonniert werden')
      }
    }),

  updateSubscription: t.procedure.input(UpdateCalendarSubscriptionInput).mutation(({ input }) => {
    const updated = subscriptions.update(input)
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND' })
    return updated
  }),

  removeSubscription: t.procedure.input(z.number().int()).mutation(({ input }) => {
    if (!subscriptions.remove(input)) throw new TRPCError({ code: 'NOT_FOUND' })
  }),

  refreshSubscriptions: t.procedure
    .input(z.number().int().optional())
    .mutation(({ input }) => subscriptions.refresh(input)),

  subscribedBetween: t.procedure
    .input(SubscribedEntriesInput)
    .query(({ input }) => subscriptions.entriesBetween(input.from, input.to))
})
