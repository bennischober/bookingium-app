import { createTRPCProxyClient } from '@trpc/client'
import { ipcLink } from 'electron-trpc/renderer'
import type { AppRouter } from '../../../main/api/router'
import type { Api, Transport } from '../../../main/mailclient/core/types'

const client = createTRPCProxyClient<AppRouter>({ links: [ipcLink()] })

/** The mail core's Api over IPC (main process → mail worker) */
export const mailTransport: Transport = {
  call: (method, ...args) =>
    client.mail.call.mutate({
      method: method as Parameters<typeof client.mail.call.mutate>[0]['method'],
      args
    }) as never
}

/** Typed Api object, e.g. `mailApi.search({ query })` */
export const mailApi = new Proxy({} as Required<Api>, {
  get:
    (_target, method: keyof Api) =>
    (...args: unknown[]) =>
      (mailTransport.call as (m: keyof Api, ...a: unknown[]) => Promise<unknown>)(method, ...args)
})
