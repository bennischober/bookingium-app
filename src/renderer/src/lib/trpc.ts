import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '../../../main/api/router'

// Shared tRPC react client binding for the renderer
export const trpcReact = createTRPCReact<AppRouter>()
