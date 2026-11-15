import { app } from 'electron'
import { container } from 'tsyringe'
import icon from '../../../resources/icon.png?asset'
import { listMailAccounts } from '../mailclient/accounts'
import { AppTray } from '../notifications/appTray'
import { stillRunningNotice } from '../notifications/noticeText'
import { SettingsService } from '../services/SettingsService'
import { showMailPage, showMainWindow } from './windows'

// #65, #142: the tray icon (set up once the app is ready)
let appTray: AppTray | null = null
let toldStillRunning = false

/**
 * #65: closing the main window keeps the app in the tray while "Beim Schließen im Infobereich
 * weiterlaufen" is on and the tray icon is there to bring it back. The first time per session a
 * notice says so. #142: with or without a mail account.
 */
export function keepInTray(): boolean {
  if (!appTray?.visible || !container.resolve(SettingsService).get().mailCloseToTray) return false
  if (!toldStillRunning) {
    toldStillRunning = true
    appTray.notify(stillRunningNotice(listMailAccounts().length > 0))
  }
  return true
}

/** #142: the tray icon, there while the app runs; mail adds its counts and menu item */
export function setUpTray(): AppTray {
  const tray = new AppTray({
    icon,
    mailAccounts: listMailAccounts,
    showApp: () => void showMainWindow(),
    showMail: showMailPage,
    quit: () => app.quit()
  })
  appTray = tray
  tray.show()
  return tray
}
