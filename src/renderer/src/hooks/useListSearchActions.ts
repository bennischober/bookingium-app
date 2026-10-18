import { useEffect } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

/**
 * URL requests a list page understands, so any part of the app (search
 * palette, "+ Neu" menu) can ask it to open a sheet:
 *   /companies?create=true  -> open the "new" form
 *   /companies?open=3       -> open record 3 for editing
 */
export type ListSearch = { create?: true; open?: number }

export function validateListSearch(search: Record<string, unknown>): ListSearch {
  const open = Number(search.open)
  return {
    create: search.create === true || search.create === 'true' ? true : undefined,
    open: search.open !== undefined && Number.isInteger(open) && open > 0 ? open : undefined
  }
}

/**
 * Runs the page's create/open action for a URL request once, then removes
 * the request from the URL (so going back or reloading doesn't reopen it).
 */
export function useListSearchActions({
  onCreate,
  onOpen
}: {
  onCreate?: () => void
  onOpen?: (id: number) => void
}) {
  const search = useSearch({ strict: false }) as ListSearch
  const navigate = useNavigate()

  useEffect(() => {
    if (!search.create && search.open === undefined) return
    if (search.create) onCreate?.()
    if (search.open !== undefined) onOpen?.(search.open)
    void navigate({ to: '.', search: {}, replace: true })
  }, [search.create, search.open]) // eslint-disable-line react-hooks/exhaustive-deps
}
