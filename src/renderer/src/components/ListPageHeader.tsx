import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * #170: the top of every list page: title, one line on what the list holds, and
 * page-wide actions on the right (the events' archive toggle).
 */
export function ListPageHeader({
  title,
  description,
  children
}: {
  title: ReactNode
  description: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/**
 * The list's toolbar for `DataTable`'s `actionButton`: export, import (the children)
 * and the "+ Neu" button last.
 */
export function ListToolbar({
  createLabel,
  onCreate,
  children
}: {
  /** The create button's text, e.g. "+ Neue Band anlegen" */
  createLabel: ReactNode
  onCreate: () => void
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <Button onClick={onCreate}>{createLabel}</Button>
    </div>
  )
}
