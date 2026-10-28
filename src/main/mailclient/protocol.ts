// Messages between the main process (MailClientService) and the mail worker
// (utility process hosting the mail core). Structured clone, so Uint8Array
// payloads (raw .eml, attachments) pass as is.
import type { Api, ImapSecurity } from './core/types'

/** Api methods the renderer may call; everything else is refused */
export const MAIL_API_METHODS = [
  'getAccount',
  'listAccounts',
  'selectAccount',
  'getSyncStatus',
  'triggerSync',
  'pauseSync',
  'resumeSync',
  'getInboxUnread',
  'listThreads',
  'getFolders',
  'listMessages',
  'getMessage',
  'completeMessage',
  'getRawEml',
  'getAttachment',
  'loadRemoteImages',
  'search',
  'markRead',
  'markFlagged',
  'moveToFolder',
  'deleteToTrash',
  'archive',
  'getContacts',
  'saveDraft',
  'sendMail',
  'deleteDraft',
  'discardDraft',
  'getDraft',
  'listOps',
  'listOpenOps',
  'getOpCounts',
  'retryOp',
  'resolveOp',
  'cancelOp',
  'undoOp',
  'expungeFromTrash',
  'listHeadersSince',
  'findByMessageIds',
  'findReplies',
  'createFolder',
  'renameFolder',
  'deleteFolder',
  'moveFolder'
] as const satisfies readonly (keyof Api)[]

export type MailApiMethod = (typeof MAIL_API_METHODS)[number]

/** Account as the worker sees it: no password, credentials are requested on demand */
export type WorkerAccount = {
  id: string
  /** "Nur lesen": the worker never writes to this mailbox */
  readOnly: boolean
  host: string
  port: number
  security: ImapSecurity
  email?: string
  /** A7: this account's own SMTP endpoint; missing in older settings, see the core */
  smtpHost?: string
  smtpPort?: number
  /** A7: the SMTP encryption, which is not the IMAP one; missing in older settings */
  smtpSecurity?: ImapSecurity
}

export type WorkerInit = {
  dataDir: string
  accounts: WorkerAccount[]
}

export type ToWorker =
  | { type: 'init'; init: WorkerInit }
  | { type: 'call'; id: number; method: MailApiMethod; args: unknown[] }
  | { type: 'credentials'; reqId: number; user?: string; pass?: string; error?: string }
  /** The machine woke from sleep: reconnect and catch up (MailCore.afterSystemResume) */
  | { type: 'resume' }
  | { type: 'close' }

export type MailEvent =
  | { type: 'sync-event'; accountId: string; event: unknown }
  | { type: 'op-event'; accountId: string; opId: string; kind: string; outcome: string }
  | { type: 'image-progress'; accountId: string; messageId: number; done: number; total: number }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'result'; id: number; value?: unknown; error?: string }
  | { type: 'credentials-request'; reqId: number; accountId: string }
  | { type: 'event'; event: MailEvent }
  // `stack` only for an error the worker itself did not catch
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; stack?: string }
  | { type: 'closed' }
