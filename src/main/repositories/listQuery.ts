import { asc, desc, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type { PaginationInput, SortDirection } from '../api/schemas/base.schema'

// ========================================
// Shared list (grid) query parts
// ========================================

/** Page bounds of a list request; an infinite query's cursor wins */
export function listPage(pagination: PaginationInput): {
  page: number
  pageSize: number
  offset: number
} {
  const page = pagination.cursor ?? pagination.page
  return { page, pageSize: pagination.pageSize, offset: (page - 1) * pagination.pageSize }
}

type Sortable = AnyColumn | SQL

/**
 * ORDER BY for a list: the requested column key (else the default), text
 * case-insensitive, empty values last in both directions, then the
 * tie-breaker so paging stays stable. `columns` maps column keys to one or
 * more SQL columns (later ones break ties, e.g. last name, first name).
 */
export function listOrder(
  pagination: Pick<PaginationInput, 'sortBy' | 'sortDir'>,
  columns: Record<string, Sortable[]>,
  fallback: { key: string; dir: SortDirection },
  tiebreak: AnyColumn
): SQL[] {
  const requested = pagination.sortBy ? columns[pagination.sortBy] : undefined
  const keyColumns = requested ?? columns[fallback.key]
  const direction = requested ? (pagination.sortDir ?? 'asc') : fallback.dir
  const order = direction === 'desc' ? desc : asc
  return [
    ...keyColumns.flatMap((column) => [
      sql`(${column} IS NULL OR ${column} = '')`,
      order(sql`${column} COLLATE NOCASE`)
    ]),
    order(tiebreak)
  ]
}
