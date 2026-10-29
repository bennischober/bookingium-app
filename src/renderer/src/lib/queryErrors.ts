/** A query's error as the tRPC client reports it */
export type QueryError = { message: string; data?: { code?: string } | null } | null | undefined

/** The router answered NOT_FOUND; any other error means the record could not be loaded */
export function isNotFound(error: QueryError): boolean {
  return error?.data?.code === 'NOT_FOUND'
}
