// Compact building blocks of the detail pages: one fact sheet instead of a card per field,
// short link lists instead of a tab per relation, and titled sections inside a tab
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { t } from '../../../../main/i18n/translate'

/** One row of a fact sheet; a null/empty value leaves the row out */
export type Fact = [label: string, value: ReactNode]

/** A titled group of facts */
export type FactGroup = { title: string; facts: Fact[] }

const filled = (value: ReactNode) =>
  value !== null && value !== undefined && value !== false && value !== ''

/**
 * The record's master data as one card: groups side by side, label and value per row.
 * Empty rows and groups are left out, so a sparse record stays short.
 */
export function FactSheet({ groups, empty }: { groups: FactGroup[]; empty?: string }) {
  const shown = groups
    .map((group) => ({ ...group, facts: group.facts.filter(([, value]) => filled(value)) }))
    .filter((group) => group.facts.length > 0)
  if (shown.length === 0)
    return (
      <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        {empty ?? t('Noch keine Angaben.')}
      </p>
    )
  return (
    <div className="grid gap-x-8 gap-y-5 rounded-lg border p-4 md:grid-cols-2">
      {shown.map((group) => (
        <div key={group.title} className="min-w-0">
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.title}
          </h3>
          <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            {group.facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

/** One entry of a link list */
export type LinkItem = { key: string; label: ReactNode; detail?: ReactNode }

/**
 * A relation as a short list (the first `limit` entries, "Alle N zeigen" for the rest).
 * Nothing at all when there are no entries: the overview only lists what exists.
 */
export function LinkList({
  title,
  items,
  limit = 5,
  action
}: {
  title: string
  items: LinkItem[] | undefined
  limit?: number
  /** e.g. a link to the full table in its tab */
  action?: ReactNode
}) {
  const [all, setAll] = useState(false)
  if (!items?.length) return null
  const shown = all ? items : items.slice(0, limit)
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title} <span className="tabular-nums">({items.length})</span>
        </h3>
        {action}
      </div>
      <ul className="divide-y rounded-lg border text-sm">
        {shown.map((item) => (
          <li key={item.key} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
            <span className="font-medium">{item.label}</span>
            {item.detail && <span className="text-muted-foreground">{item.detail}</span>}
          </li>
        ))}
      </ul>
      {items.length > limit && (
        <button
          type="button"
          className="mt-1.5 text-sm text-primary underline-offset-2 hover:underline"
          onClick={() => setAll((value) => !value)}
        >
          {all ? t('Weniger zeigen') : t('Alle {{length}} zeigen', { length: items.length })}
        </button>
      )}
    </div>
  )
}

/** A titled part of a tab that holds more than one area (Ablauf: Tagesablauf and Advancing) */
export function TabSection({
  id,
  title,
  children,
  className
}: {
  /** Anchor, so an older link to the former tab scrolls here */
  id?: string
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('scroll-mt-4 space-y-4', className)}>
      <h2 className="border-b pb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** One item of the status line on top of an overview */
export type StatusItem = {
  label: string
  value: ReactNode
  tone?: 'ok' | 'warn' | 'muted'
  onClick?: () => void
}

const TONES = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  muted: 'text-muted-foreground'
}

/** The record's state in one line of small tiles; a tile with `onClick` leads to its area */
export function StatusLine({ items }: { items: StatusItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label={t('Stand')}>
      {items.map((item) => {
        const body = (
          <>
            <span className="block text-xs text-muted-foreground">{item.label}</span>
            <span
              className={cn('block truncate text-sm font-medium', item.tone && TONES[item.tone])}
            >
              {item.value}
            </span>
          </>
        )
        return item.onClick ? (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className="rounded-lg border px-3 py-2 text-left hover:bg-muted/60"
          >
            {body}
          </button>
        ) : (
          <div key={item.label} className="rounded-lg border px-3 py-2">
            {body}
          </div>
        )
      })}
    </div>
  )
}
