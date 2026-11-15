import { TRPCError, type DefaultErrorShape } from '@trpc/server'
import { TRPC_ERROR_CODES_BY_KEY } from '@trpc/server/rpc'
import { getHTTPStatusCodeFromError } from '@trpc/server/http'

/**
 * electron-trpc bundles its own TRPCError class, so its instanceof check misses the
 * routers' errors and wraps each one as INTERNAL_SERVER_ERROR. Restore the thrown
 * error's code so the renderer can tell NOT_FOUND or BAD_REQUEST from a failure.
 *
 * The message is what the renderer shows in its error toast, so it is also made readable:
 * a rejected input becomes its German issue messages instead of zod's JSON, and a SQLite
 * constraint error becomes a German sentence.
 */
export function errorFormatter({
  shape,
  error
}: {
  shape: DefaultErrorShape
  error: { cause?: unknown }
}): DefaultErrorShape {
  const thrown = error.cause
  const message = readableMessage(thrown) ?? shape.message
  if (!(thrown instanceof TRPCError)) return { ...shape, message }
  return {
    ...shape,
    message,
    code: TRPC_ERROR_CODES_BY_KEY[thrown.code],
    data: { ...shape.data, code: thrown.code, httpStatus: getHTTPStatusCodeFromError(thrown) }
  }
}

/** A German message for errors whose own text is not meant for people; undefined keeps it */
export function readableMessage(thrown: unknown): string | undefined {
  const issues = zodIssues(thrown instanceof TRPCError ? thrown.cause : thrown)
  if (issues) {
    const messages = [...new Set(issues.map((issue) => issue.message))]
    return messages.length > 0 ? messages.join(' · ') : 'Die Eingabe ist ungültig.'
  }
  const text = thrown instanceof Error ? thrown.message : ''
  if (/UNIQUE constraint failed/.test(text)) return 'Diesen Eintrag gibt es schon.'
  if (/FOREIGN KEY constraint failed/.test(text))
    return 'Der Eintrag hängt noch mit anderen Einträgen zusammen.'
  return undefined
}

/** zod's issues, recognized by shape: the schemas and the routers may load different zod copies */
function zodIssues(value: unknown): { message: string }[] | undefined {
  if (!(value instanceof Error) || value.name !== 'ZodError') return undefined
  const issues = (value as { issues?: unknown }).issues
  return Array.isArray(issues) ? (issues as { message: string }[]) : undefined
}
