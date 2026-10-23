import { initTRPC, TRPCError } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'
import { deleteMailAccount, listMailAccounts, saveMailAccount } from '../../mailclient/accounts'
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
  user: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(1).optional()
})

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

    /** The password is encrypted with safeStorage and never returned */
    save: t.procedure.input(SaveMailAccountInput).mutation(async ({ input }) => {
      try {
        const account = saveMailAccount(input)
        await mailClient.restart()
        return account
      } catch (error) {
        throw badRequest(error, 'Konto konnte nicht gespeichert werden')
      }
    }),

    delete: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      deleteMailAccount(input.id)
      await mailClient.restart()
    })
  })
})
