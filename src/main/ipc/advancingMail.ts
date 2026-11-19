import { ipcMain } from 'electron'
import { container } from 'tsyringe'
import { advancingDraft } from '../advancing/advancingMail'
import { AdvancingRepository } from '../repositories/AdvancingRepository'
import { AdvancingService } from '../services/AdvancingService'
import { SettingsService } from '../services/SettingsService'
import { documentSender } from '../mail/documentSender'
import { openComposeWindow } from './documentMail'
import { failure } from './handlerUtils'

/**
 * #235: "Advancing-Mail schreiben" of the event's Advancing tab: the compose window with the
 * questions every show needs answered, to the promoter's contact with the contact on site in cc.
 * Once the mail is out, a show not yet further is "angeschrieben" from today.
 */
export function registerAdvancingMailIpc(): void {
  ipcMain.handle('advancing:email', async (_event, { eventId }: { eventId: number }) => {
    try {
      const repository = container.resolve(AdvancingRepository)
      const show = repository.showOf(eventId)
      if (!show) return { success: false, error: 'Event nicht gefunden' }
      const sender = documentSender(container.resolve(SettingsService).get())
      if ('error' in sender) return { success: false, ...sender }
      const draft = advancingDraft(
        {
          date: show.date,
          bandName: show.bandName ?? show.name,
          venueName: show.venueName ?? '',
          city: show.city ?? '',
          performanceTime: show.performanceTime
        },
        repository.mailAddresses(eventId)
      )
      const composed = await openComposeWindow({
        draft,
        compose: { advancingEventId: eventId, accountId: sender.account.id },
        record: { type: 'event', id: eventId }
      })
      if (composed.sent) container.resolve(AdvancingService).markContacted(eventId)
      return { success: true, sent: composed.sent }
    } catch (error) {
      console.error('Error creating advancing email:', error)
      return failure(error)
    }
  })
}
