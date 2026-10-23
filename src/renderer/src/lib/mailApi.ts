import { createTRPCProxyClient } from '@trpc/client'
import { ipcLink } from 'electron-trpc/renderer'
import type { AppRouter } from '../../../main/api/router'
import type { MailCore } from '../../../main/mailclient/core'
import type { MailApiMethod } from '../../../main/mailclient/protocol'

const client = createTRPCProxyClient<AppRouter>({ links: [ipcLink()] })

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
      client.mail.call.mutate({ method, args })
})
