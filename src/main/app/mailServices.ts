import { net, powerMonitor } from 'electron'
import { container } from 'tsyringe'
import { confirmInvoiceSendFromOp, invoiceComposes } from '../mail/invoiceSend'
import { listMailAccounts } from '../mailclient/accounts'
import type { FolderNode, OpSummary } from '../mailclient/core/types'
import { inboxUnreadOf, inboxWatch } from '../mailclient/inboxWatch'
import { mailClient } from '../mailclient/MailClientService'
import type { MailEvent } from '../mailclient/protocol'
import { watchSystemWake } from '../mailclient/systemWake'
import type { AppTray } from '../notifications/appTray'
import { newMailChannel, newMailNotice } from '../notifications/noticeText'
import { contactAddressEvents } from '../repositories/contactEmails'
import { InvoiceService } from '../services/InvoiceService'
import { MailLinkService, mailLinkRunner, ownMailAddresses } from '../services/MailLinkService'
import { MailRuleService, ruleFolder } from '../services/MailRuleService'
import { SettingsService } from '../services/SettingsService'
import { getMainWindow, showMailPage, windowFocus } from './windows'

/**
 * What the app does around the mail client (`mailclient/`): starting it, the tray's unread
 * counts and new-mail notices, confirming invoice sends, linking mail to records and the
 * user's mail rules. The mail core itself stays in its utility process.
 */

/**
 * Starts the mail client. I7 (H3): an invoice mail whose send was unclear is marked once the
 * core confirms it - by the startup probe too, so this listens before the client starts.
 */
export function startMailClient(): void {
  const invoiceLedger = container.resolve(InvoiceService)
  mailClient.events.on('event', (event) => {
    void confirmInvoiceSendFromOp(
      {
        registry: invoiceComposes,
        ledger: invoiceLedger,
        listOps: (accountId) => mailClient.call('listOps', [accountId]) as Promise<OpSummary[]>
      },
      event
    ).catch((error) => console.error('Confirming an invoice mail failed:', error))
  })
  // Mail client (utility process): background sync for configured accounts. #136: always
  // part of the app; without an account the worker never starts.
  mailClient.startIfConfigured()
  // After sleep the worker's sockets may be dead without either side knowing: it reconnects and
  // catches up once per wake
  watchSystemWake(() => mailClient.notifySystemResume(), {
    onResume: (listener) => powerMonitor.on('resume', listener),
    isOnline: () => net.isOnline()
  })
}

/**
 * #65: the watcher reads each INBOX's unread count after every sync and every own write, puts it
 * on the tray icon and announces new mail
 */
export function setUpMailWatch(tray: AppTray): void {
  const settings = container.resolve(SettingsService)
  const watch = inboxWatch({
    accountIds: () => listMailAccounts().map((account) => account.id),
    inboxUnread: async (accountId) =>
      inboxUnreadOf((await mailClient.call('getFolders', [accountId])) as FolderNode[]),
    onCounts: (unread) => tray.setCounts(unread),
    onNewMail: (accountId, count) => {
      // #133: each announcement has its own switch, both off by default (the popup in the app
      // also leaves it out on the mail page)
      const { mailNotifications, mailInAppNotifications } = settings.get()
      const channel = newMailChannel(windowFocus(), {
        desktop: mailNotifications,
        inApp: mailInAppNotifications
      })
      if (!channel) return
      const email = listMailAccounts().find((account) => account.id === accountId)?.email ?? ''
      const notice = newMailNotice(count, email)
      if (channel === 'desktop') tray.notify(notice, () => showMailPage(accountId))
      else getMainWindow()?.webContents.send('app:newMail', { ...notice, accountId })
    },
    log: (error) => console.warn('[mail] reading the INBOX unread count failed:', error)
  })
  // Started, stopped, restarted after an account change: the mail parts come or go
  mailClient.events.on('status', (status: { running: boolean }) => {
    tray.refresh()
    if (status.running) watch.onRunning()
  })
  mailClient.events.on('event', watch.onEvent)
}

/**
 * C2: link incoming mail to the records it belongs to, after each folder sync. The linker
 * yields between batches, so a big mailbox never blocks the app. #124: then the user's rules.
 */
export function startMailLinking(): void {
  const mailLinks = container.resolve(MailLinkService)
  // #55: the database keeps each account's address, so a backup can find its account again
  mailLinks.rememberAccounts(listMailAccounts())
  const mailLinkRuns = mailLinkRunner({
    // Every configured account's address and alias is the user's own (host L3)
    link: async (accountId) => {
      const result = await mailLinks.linkAccount(accountId, ownMailAddresses(listMailAccounts()))
      // #121: follow-ups closed by a reply; the open windows show them done
      if (result.answered > 0) {
        mailClient.events.emit('event', {
          type: 'follow-ups-answered',
          accountId,
          count: result.answered
        } satisfies MailEvent)
      }
      return result
    },
    log: (error) => console.error('Linking mail failed:', error)
  })
  mailClient.events.on('event', mailLinkRuns.onEvent)
  // #124: the user's rules for incoming mail, after each INBOX sync. Marking and moving are
  // server writes, so a "Nur lesen" account only gets the links.
  const mailRules = container.resolve(MailRuleService)
  const mailRuleRuns = mailLinkRunner({
    folder: ruleFolder,
    link: async (accountId) => {
      const account = listMailAccounts().find((a) => a.id === accountId)
      const canWrite = account !== undefined && !account.readOnly && !account.writeRefusal
      const count = await mailRules.applyRules(accountId, canWrite)
      if (count > 0) {
        mailClient.events.emit('event', {
          type: 'mail-rules-applied',
          accountId,
          count
        } satisfies MailEvent)
      }
      return count
    },
    log: (error) => console.error('Applying mail rules failed:', error)
  })
  mailClient.events.on('event', mailRuleRuns.onEvent)
  // A contact that gained an address gets its older mail too: the run sees the changed
  // addresses and starts again from the first mail
  contactAddressEvents.on('saved', () => {
    for (const account of listMailAccounts()) mailLinkRuns.run(account.id)
  })
}
