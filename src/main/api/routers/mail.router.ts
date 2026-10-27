import { initTRPC, TRPCError } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import {
  isSafeToOpen,
  markFromInternet,
  safePathIn,
  storedAttachmentName
} from '../../mailclient/attachments'
import {
  checkMailAccountSave,
  checkMailAccountSettings,
  deleteMailAccount,
  listMailAccounts,
  saveMailAccount,
  storedPasswordFor,
  type MailAccountDto
} from '../../mailclient/accounts'
import {
  testImapConnection,
  type ConnectionTestResult
} from '../../mailclient/core/connection_test'
import { mailClient } from '../../mailclient/MailClientService'
import { MAIL_API_METHODS, type MailEvent } from '../../mailclient/protocol'
import { container } from 'tsyringe'
import { RecipientLookupService } from '../../services/RecipientLookupService'
import { InvoiceService } from '../../services/InvoiceService'
import { invoiceComposes, sendInvoiceMail } from '../../mail/invoiceSend'
import { SendInvoiceMailInput } from '../schemas/invoice.schema'
import type { DraftInput } from '../../mailclient/core/types'

const recipientLookup = container.resolve(RecipientLookupService)

const t = initTRPC.create()

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

const SaveMailAccountInput = z.object({
  id: z.string().optional(),
  kind: z.enum(['sandbox', 'production-readonly']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls', 'none']),
  user: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(1).optional(),
  /** B8: plain-text signature, appended to new mail and above the quote */
  signature: z.string().optional(),
  /** A7: this account's own SMTP endpoint; defaults to the IMAP host on 1025 */
  smtpHost: z.string().min(1).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  /** A7: the SMTP encryption; defaults to the IMAP security */
  smtpSecurity: z.enum(['tls', 'starttls', 'none']).optional(),
  /** A7 part 2: admit this account as the one real mailbox writes may reach */
  canary: z.boolean().optional()
})

const TestMailAccountInput = SaveMailAccountInput.omit({ email: true })

/** B6: which attachment of which mail. I11 (MR-23): no name - main takes the stored one */
const AttachmentInput = z.object({
  accountId: z.string().min(1),
  messageId: z.number().int().positive(),
  partId: z.string().min(1)
})

/** Temp folder for opened attachments; wiped of old files at startup */
const attachmentTempDir = (): string => join(app.getPath('temp'), 'bookingum-mail')
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** The attachment bytes, straight from the worker */
async function attachmentBytes(input: z.infer<typeof AttachmentInput>): Promise<Uint8Array> {
  try {
    return (await mailClient.call('getAttachment', [
      input.messageId,
      input.partId,
      input.accountId
    ])) as Uint8Array
  } catch (error) {
    throw badRequest(error, 'Anhang konnte nicht geladen werden')
  }
}

/** I11 (MR-23): the attachment's name as stored with the mail, sanitized */
async function attachmentName(input: z.infer<typeof AttachmentInput>): Promise<string> {
  try {
    const detail = (await mailClient.call('getMessage', [input.messageId, input.accountId])) as {
      attachments: { partId: string; filename: string | null }[]
    }
    return storedAttachmentName(detail.attachments, input.partId)
  } catch (error) {
    throw badRequest(error, 'Anhang konnte nicht geladen werden')
  }
}

/**
 * Writes the bytes under a sanitized name into the temp folder, never elsewhere, and marks
 * them as downloaded from the internet (I11, MR-23). A file that cannot be marked is not opened.
 */
async function writeAttachment(
  input: z.infer<typeof AttachmentInput>,
  name: string
): Promise<string> {
  const dir = attachmentTempDir()
  // A per-message subfolder keeps same-named attachments from overwriting each other
  const sub = `${input.messageId}-${input.partId.replace(/[^a-zA-Z0-9]/g, '')}`
  const folder = join(dir, sub)
  await mkdir(folder, { recursive: true })
  const bytes = await attachmentBytes(input)
  const target = safePathIn(folder, name)
  await writeFile(target, Buffer.from(bytes))
  await markFromInternet(target)
  return target
}

/** "Speichern unter...": the user picks the path, main writes and marks the bytes */
async function saveAttachmentAs(
  input: z.infer<typeof AttachmentInput>,
  name: string
): Promise<string | null> {
  const bytes = await attachmentBytes(input)
  const owner = BrowserWindow.getFocusedWindow()
  const options: Electron.SaveDialogOptions = {
    title: 'Anhang speichern',
    defaultPath: join(app.getPath('downloads'), name),
    filters: [{ name: basename(name), extensions: [name.split('.').pop() ?? 'bin'] }]
  }
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  try {
    await writeFile(result.filePath, Buffer.from(bytes))
  } catch (error) {
    throw badRequest(error, 'Anhang konnte nicht gespeichert werden')
  }
  // A drive without NTFS streams (a FAT stick) cannot carry the mark; the file is saved anyway
  await markFromInternet(result.filePath).catch(() => undefined)
  return result.filePath
}

/** Startup: drop opened attachments older than a day */
export async function cleanAttachmentTemp(): Promise<void> {
  const dir = attachmentTempDir()
  const entries = await readdir(dir).catch(() => [] as string[])
  const cutoff = Date.now() - TEMP_MAX_AGE_MS
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      const info = await stat(full)
      if (info.mtimeMs < cutoff) await rm(full, { recursive: true, force: true })
    } catch {
      // A file that is gone already, or one another instance holds, is not an error here
    }
  }
}

/**
 * One login with the given settings; without a password, the stored one of `id` - but only
 * for the server, port and login it was saved for (I11, MR-33)
 */
async function testAccount(
  input: z.infer<typeof TestMailAccountInput>
): Promise<ConnectionTestResult> {
  checkMailAccountSettings(input)
  const pass = input.password ?? (input.id ? storedPasswordFor(input.id, input) : undefined)
  if (!pass) throw new Error('Passwort fehlt')
  return testImapConnection({
    host: input.host.trim(),
    port: input.port,
    security: input.security,
    user: input.user.trim(),
    pass
  })
}

export const mailRouter = t.router({
  /**
   * B6: attachment files are opened and saved by the main process only - the renderer
   * never receives bytes plus a path it could write to itself.
   */
  attachments: t.router({
    /**
     * Writes the attachment into a temp folder, marked as from the internet, and hands it to
     * the OS - for an allowlisted type only. I11 (MR-23): any other type is never started;
     * main itself asks whether to save it instead, so the renderer decides nothing.
     */
    open: t.procedure.input(AttachmentInput).mutation(async ({ input }) => {
      const name = await attachmentName(input)
      if (!isSafeToOpen(name)) {
        const owner = BrowserWindow.getFocusedWindow()
        const options: Electron.MessageBoxOptions = {
          type: 'warning',
          title: 'Anhang öffnen',
          message: `„${name}“ wird nicht direkt geöffnet.`,
          detail:
            'Dateien dieses Typs können Programme starten oder Makros ausführen. ' +
            'Speichern Sie die Datei und prüfen Sie sie, bevor Sie sie öffnen.',
          buttons: ['Speichern unter …', 'Abbrechen'],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        }
        const choice = owner
          ? await dialog.showMessageBox(owner, options)
          : await dialog.showMessageBox(options)
        if (choice.response !== 0) return { opened: false, saved: false, name }
        const filePath = await saveAttachmentAs(input, name)
        return { opened: false, saved: filePath !== null, name }
      }
      const file = await writeAttachment(input, name)
      const error = await shell.openPath(file)
      if (error) throw badRequest(new Error(error), 'Anhang konnte nicht geöffnet werden')
      return { opened: true, saved: false, name }
    }),

    /** "Speichern unter...": the user picks the path, the main process writes the bytes */
    saveAs: t.procedure.input(AttachmentInput).mutation(async ({ input }) => {
      const name = await attachmentName(input)
      const filePath = await saveAttachmentAs(input, name)
      return { saved: filePath !== null, filePath, name }
    })
  }),
  /**
   * The mail core's Api (src/main/mailclient/core/types.ts), method by method.
   * The renderer's transport implements Api on top of this one procedure.
   */
  call: t.procedure
    .input(z.object({ method: z.enum(MAIL_API_METHODS), args: z.array(z.unknown()) }))
    .mutation(async ({ input }) => {
      try {
        return await mailClient.call(input.method, input.args)
      } catch (error) {
        throw badRequest(error, 'E-Mail-Aktion fehlgeschlagen')
      }
    }),

  /**
   * I7: the invoice mail of a compose window. The window holds only a token; main attaches
   * the PDF the invoice:email handler registered for it and records the send, so the
   * invoice is marked once the mail is out (see mail/invoiceSend.ts).
   */
  sendInvoice: t.procedure.input(SendInvoiceMailInput).mutation(async ({ input }) => {
    try {
      return await sendInvoiceMail(
        {
          registry: invoiceComposes,
          ledger: container.resolve(InvoiceService),
          readPdf: (path) => readFile(path),
          send: (mail, draftUid, accountId) =>
            mailClient.call('sendMail', [mail, draftUid, accountId]) as Promise<{
              messageId: string
            }>
        },
        { ...input, mail: input.mail as unknown as DraftInput }
      )
    } catch (error) {
      throw badRequest(error, 'Senden fehlgeschlagen')
    }
  }),

  status: t.procedure.query(() => mailClient.status()),

  /**
   * Recipient lookup for the compose field: the app's own records plus the addresses the mail store
   * remembers, merged and ranked.
   *
   * The mail core cannot read the app database (dependency-free by design), so the merge happens
   * here: the repository gathers persons/companies/venues, the mail store adds what it has seen in
   * message headers, and mergeRecipients() decides what is shown. Without this, a person you have on
   * file but never mailed is invisible when composing.
   */
  contacts: t.procedure
    .input(z.object({ query: z.string(), accountId: z.string().optional() }))
    .query(async ({ input }) => {
      // mail history is a nicety here; a mail store that is not up must not break the dropdown
      const history = (await mailClient
        .call('getContacts', [input.query, input.accountId])
        .catch(() => [])) as { name: string; email: string }[]
      return recipientLookup.lookup(input.query, history)
    }),

  /** Sync progress and write-op events from the core */
  events: t.procedure.subscription(() =>
    observable<MailEvent>((emit) => {
      const onEvent = (e: MailEvent): void => emit.next(e)
      mailClient.events.on('event', onEvent)
      return () => mailClient.events.off('event', onEvent)
    })
  ),

  accounts: t.router({
    list: t.procedure.query(() => listMailAccounts()),

    /**
     * "Verbindung testen": one attempt, at most 15 s. A saved live account's sync pauses
     * meanwhile (at most 15 s more), so its server never sees more than two connections.
     */
    test: t.procedure.input(TestMailAccountInput).mutation(async ({ input }) => {
      try {
        return input.id && input.kind !== 'sandbox'
          ? await mailClient.whileStopped(() => testAccount(input))
          : await testAccount(input)
      } catch (error) {
        throw badRequest(error, 'Verbindungstest fehlgeschlagen')
      }
    }),

    /**
     * Saves only settings that pass the connection test, then restarts the sync with them
     * (which also lifts the stop after a rejected login). The password is encrypted with
     * safeStorage and never returned.
     */
    save: t.procedure
      .input(SaveMailAccountInput)
      .mutation(
        async ({ input }): Promise<{ test: ConnectionTestResult; account?: MailAccountDto }> => {
          try {
            // I6 (MR-20): settings main refuses never reach a server, not even for the test
            checkMailAccountSave(input)
            return await mailClient.whileStopped(async () => {
              const test = await testAccount(input)
              return test.ok ? { test, account: saveMailAccount(input) } : { test }
            })
          } catch (error) {
            throw badRequest(error, 'Konto konnte nicht gespeichert werden')
          }
        }
      ),

    delete: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      deleteMailAccount(input.id)
      await mailClient.restart()
    })
  })
})
