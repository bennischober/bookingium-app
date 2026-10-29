import { TRPCError, type DefaultErrorShape } from '@trpc/server'
import { TRPC_ERROR_CODES_BY_KEY } from '@trpc/server/rpc'
import { getHTTPStatusCodeFromError } from '@trpc/server/http'

/**
 * electron-trpc bundles its own TRPCError class, so its instanceof check misses the
 * routers' errors and wraps each one as INTERNAL_SERVER_ERROR. Restore the thrown
 * error's code so the renderer can tell NOT_FOUND or BAD_REQUEST from a failure.
 */
export function errorFormatter({
  shape,
  error
}: {
  shape: DefaultErrorShape
  error: { cause?: unknown }
}): DefaultErrorShape {
  const thrown = error.cause
  if (!(thrown instanceof TRPCError)) return shape
  return {
    ...shape,
    code: TRPC_ERROR_CODES_BY_KEY[thrown.code],
    data: { ...shape.data, code: thrown.code, httpStatus: getHTTPStatusCodeFromError(thrown) }
  }
}
