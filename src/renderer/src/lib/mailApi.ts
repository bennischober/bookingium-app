import type { MailCore } from '../../../main/mailclient/core'
import type { MailApiMethod } from '../../../main/mailclient/protocol'
import { trpcVanilla } from './trpc'

/**
 * The core's methods as the worker serves them, with the trailing accountId
 * each one takes (the Api interface leaves it out), e.g.
 * `mailApi.getFolders(accountId)`
 */
export type MailClientApi = Pick<MailCore, MailApiMethod>

export const mailApi = new Proxy({} as MailClientApi, {
  get:
    (_target, method: MailApiMethod) =>
    (...args: unknown[]) =>
      trpcVanilla.mail.call.mutate({ method, args })
})
