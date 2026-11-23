import { TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { AccessError, AccessService } from '../services/AccessService'

// #262: the main-process side of staff access. Hiding a menu is not enough: every procedure
// of a company-internal area calls this, so a locked computer cannot reach it at all.

/** Throws FORBIDDEN while this computer is in staff access and locked */
export function requireAdmin(): void {
  try {
    container.resolve(AccessService).assertAdmin()
  } catch (error) {
    if (error instanceof AccessError)
      throw new TRPCError({ code: 'FORBIDDEN', message: error.message })
    throw error
  }
}

/**
 * tRPC middleware for the routers' own `t` (each router has its own initTRPC instance):
 * `const adminProcedure = t.procedure.use(t.middleware(adminOnly))`
 */
export function adminOnly<T>({ next }: { next: () => T }): T {
  requireAdmin()
  return next()
}
