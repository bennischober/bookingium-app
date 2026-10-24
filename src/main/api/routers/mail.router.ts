import { initTRPC, TRPCError } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { isExecutableName, safeAttachmentName } from '../../mailclient/attachments'
import {
  checkMailAccountSettings,
  deleteMailAccount,
  listMailAccounts,
  mailCredentials,
  saveMailAccount,
  type MailAccountDto
} from '../../mailclient/accounts'
import {
  testImapConnection,
  type ConnectionTestResult
} from '../../mailclient/core/connection_test'
import { mailClient } from '../../mailclient/MailClientService'
import { MAIL_API_METHODS, type MailEvent } from '../../mailclient/protocol'

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
  smtpPort: z.number().int().min(1).max(65535).optional()
})

const TestMailAccountInput = SaveMailAccountInput.omit({ email: true })

/** B6: which attachment of which mail */
const AttachmentInput = z.object({
  accountId: z.string().min(1),
  messageId: z.number().int().positive(),
  partId: z.string().min(1),
  filename: z.string()
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

/** Writes the bytes under a sanitized name into the temp folder, never elsewhere */
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
  const target = join(folder, name)
  await writeFile(target, Buffer.from(bytes))
  return target
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

/** One login with the given settings; without a password, the stored one of `id` */
async function testAccount(
  input: z.infer<typeof TestMailAccountInput>
): Promise<ConnectionTestResult> {
  checkMailAccountSettings(input)
  const pass = input.password ?? (input.id ? mailCredentials(input.id).pass : undefined)
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
     * Writes the attachment into a temp folder and hands it to the OS. Returns the
     * sanitized name and, for an executable, `warning` so the UI can ask first.
     */
    open: t.procedure.input(AttachmentInput).mutation(async ({ input }) => {
      const name = safeAttachmentName(input.filename, 'Anhang')
      if (isExecutableName(name)) return { opened: false, name, executable: true }
      const file = await writeAttachment(input, name)
      const error = await shell.openPath(file)
      if (error) throw badRequest(new Error(error), 'Anhang konnte nicht geöffnet werden')
      return { opened: true, name, executable: false }
    }),

    /** Opens the attachment even though it is executable (the user confirmed) */
    openAnyway: t.procedure.input(AttachmentInput).mutation(async ({ input }) => {
      const name = safeAttachmentName(input.filename, 'Anhang')
      const file = await writeAttachment(input, name)
      const error = await shell.openPath(file)
      if (error) throw badRequest(new Error(error), 'Anhang konnte nicht geöffnet werden')
      return { opened: true, name }
    }),

    /** "Speichern unter...": the user picks the path, the main process writes the bytes */
    saveAs: t.procedure.input(AttachmentInput).mutation(async ({ input }) => {
      const name = safeAttachmentName(input.filename, 'Anhang')
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
      if (result.canceled || !result.filePath) return { saved: false, filePath: null, name }
      try {
        await writeFile(result.filePath, Buffer.from(bytes))
      } catch (error) {
        throw badRequest(error, 'Anhang konnte nicht gespeichert werden')
      }
      return { saved: true, filePath: result.filePath, name }
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

  status: t.procedure.query(() => mailClient.status()),

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
