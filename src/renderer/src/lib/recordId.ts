/**
 * The record id in a detail route's param (`/bands/$bandId`), or null when the
 * param is not a positive integer. Detail pages show "nicht gefunden" for null
 * instead of querying: a disabled query stays in its loading state for good.
 */
export function parseRecordId(param: string | undefined): number | null {
  if (param === undefined || !/^\d+$/.test(param)) return null
  const id = Number(param)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
