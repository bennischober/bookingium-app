import { initTRPC, TRPCError } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'
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
  password: z.string().min(1).optional()
})

const TestMailAccountInput = SaveMailAccountInput.omit({ email: true })

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
     * "Verbindung testen": one attempt, at most 15 s. A saved account's sync pauses meanwhile,
     * so a live server never sees more than its two connections.
     */
    test: t.procedure.input(TestMailAccountInput).mutation(async ({ input }) => {
      try {
        return input.id
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
