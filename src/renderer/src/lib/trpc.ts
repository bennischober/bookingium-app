import { createTRPCClientProxy } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import { ipcLink } from 'electron-trpc/renderer'
import type { AppRouter } from '../../../main/api/router'

// Shared tRPC react client binding for the renderer
export const trpcReact = createTRPCReact<AppRouter>()

/**
 * The renderer's one tRPC client. electron-trpc matches responses to requests by
 * operation id only, and every client counts its ids from 1 — a second client would
 * get answers meant for the first (e.g. a subscription event resolving a mutation).
 */
export const trpcClient = trpcReact.createClient({ links: [ipcLink()] })

/** The same client for calls outside React (no hooks) */
export const trpcVanilla = createTRPCClientProxy(trpcClient)
