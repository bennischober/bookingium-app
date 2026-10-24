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
  'listThreads',
  'getFolders',
  'listMessages',
  'getMessage',
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
  'getOpCounts',
  'retryOp',
  'resolveOp',
  'cancelOp',
  'undoOp',
  'expungeFromTrash',
  'listHeadersSince',
  'findByMessageIds'
] as const satisfies readonly (keyof Api)[]

export type MailApiMethod = (typeof MAIL_API_METHODS)[number]

/** Account as the worker sees it: no password, credentials are requested on demand */
export type WorkerAccount = {
  id: string
  kind: 'sandbox' | 'production-readonly'
  host: string
  port: number
  security: ImapSecurity
  email?: string
}

export type WorkerInit = {
  dataDir: string
  accounts: WorkerAccount[]
  /** Write target for sandbox accounts (local Dovecot + Mailpit only; the core's guard checks the hosts) */
  sandbox?: {
    imapHost: string
    imapPort: number
    smtpHost: string
    smtpPort: number
    user: string
    pass: string
  }
}

export type ToWorker =
  | { type: 'init'; init: WorkerInit }
  | { type: 'call'; id: number; method: MailApiMethod; args: unknown[] }
  | { type: 'credentials'; reqId: number; user?: string; pass?: string; error?: string }
  | { type: 'close' }

export type MailEvent =
  | { type: 'sync-event'; accountId: string; event: unknown }
  | { type: 'op-event'; accountId: string; opId: string; kind: string; outcome: string }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'result'; id: number; value?: unknown; error?: string }
  | { type: 'credentials-request'; reqId: number; accountId: string }
  | { type: 'event'; event: MailEvent }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'closed' }
