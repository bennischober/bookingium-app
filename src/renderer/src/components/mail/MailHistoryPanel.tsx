import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Paperclip, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { EmptyState, ErrorState, LoadingRow } from '@/components/load-states'
import { cn } from '@/lib/utils'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { formatListDate } from '@/components/mail/format'
import type { MailLinkRow } from '../../../../main/api/routers/mail_link.router'

/**
 * C3: the mails of one record, newest first.
 *
 * A band also shows the mails of its events; the link source is shown small, so
 * "automatisch" and "zugeordnet" are distinguishable. A link whose mail is no
 * longer in the store stays and says so - the record keeps its history.
 */
export function MailHistoryPanel({
  entityType,
  entityId
}: {
  entityType: 'person' | 'company' | 'band' | 'venue' | 'event'
  entityId: number
}) {
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  const showAgain = (id: number) =>
    setRemoved((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  const links = trpcReact.mailLink.listByEntity.useInfiniteQuery(
    { entityType, entityId, limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined }
  )
  const restore = trpcReact.mailLink.restore.useMutation({
    onSuccess: (_data, { id }) => {
      showAgain(id)
      void links.refetch()
    },
    onError: (error) =>
      toast.error('Zuordnung konnte nicht wiederhergestellt werden', {
        description: error.message
      })
  })
  const dismiss = trpcReact.mailLink.dismiss.useMutation({
    onSuccess: (_data, { id }) => {
      void links.refetch()
      toast.success('Zuordnung entfernt', {
        description: 'Die E-Mail bleibt im Postfach.',
        action: { label: 'Rückgängig', onClick: () => restore.mutate({ id }) }
      })
    },
    onError: (error, { id }) => {
      // The row was hidden right away; it is still linked, so it shows again
      showAgain(id)
      toast.error('Zuordnung konnte nicht entfernt werden', {
        description: error.message
      })
    }
  })

  if (links.isLoading) {
    return <LoadingRow>E-Mails werden geladen…</LoadingRow>
  }
  if (links.isError) {
    return <ErrorState error={links.error} onRetry={() => void links.refetch()} />
  }
  const pages = links.data?.pages ?? []
  // The mailbox did not answer: rows without a mail are not known to be gone
  const unavailable = pages.some((page) => page.unavailable)
  const rows = pages.flatMap((page) => page.rows).filter((row) => !removed.has(row.id))
  if (rows.length === 0) {
    return (
      <EmptyState className="space-y-1">
        <p>Keine E-Mails zugeordnet.</p>
        <p>
          E-Mails werden über die E-Mail-Adressen der Kontakte automatisch zugeordnet. Andere ordnen
          Sie unter{' '}
          <Link to="/mail" className="underline underline-offset-2 hover:text-foreground">
            E-Mail
          </Link>{' '}
          mit „Zuordnen…“ zu.
        </p>
      </EmptyState>
    )
  }

  const open = (row: MailLinkRow) => {
    if (row.storeId !== null && row.accountId) {
      void window.api.openMailWindow(row.accountId, row.storeId)
    }
  }
  const title = (row: MailLinkRow) => {
    if (row.storeId !== null) return row.subject || '(kein Betreff)'
    return unavailable ? 'Postfach gerade nicht erreichbar' : 'Nicht mehr im Postfach'
  }
  // A mail that is no longer in the store has no read state of its own; it is
  // shown as read rather than inventing an unread dot
  const isRead = (row: MailLinkRow) => row.unread === false

  return (
    <div className="space-y-2">
      {unavailable && (
        <p className="text-sm text-muted-foreground">
          Postfach gerade nicht erreichbar, Betreff und Absender fehlen.
        </p>
      )}
      <ul className="divide-y rounded-md border" aria-label="E-Mails">
        {rows.map((row) => (
          <li key={row.id} className="group/row flex items-start gap-3 px-3 py-2 text-sm">
            {/* The same order as the /mail list: unread dot, sender, icons, date */}
            <span className="flex size-4 shrink-0 items-center justify-center self-center">
              {!isRead(row) && (
                <span className="size-2 rounded-full bg-primary" aria-label="Ungelesen" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={cn('min-w-0 flex-1 truncate', !isRead(row) && 'font-semibold')}>
                  {row.fromName || row.fromEmail || '(Unbekannt)'}
                </span>
                {row.hasAttachments && (
                  <Paperclip
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-label="Anhang"
                  />
                )}
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {row.date ? formatListDate(row.date) : ''}
                </span>
              </div>
              <button
                type="button"
                className={cn(
                  'block max-w-full truncate text-left hover:underline disabled:no-underline',
                  !isRead(row) && 'font-medium'
                )}
                /* A mail that is no longer in the store cannot be opened */
                disabled={row.storeId === null}
                onClick={() => open(row)}
              >
                {title(row)}
              </button>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {/* Where the mail came from: only a band's tab mixes events in */}
                {row.sourceEvent && (
                  <Badge variant="outline" className="max-w-full truncate font-normal">
                    {row.sourceEvent.name}
                  </Badge>
                )}
                <span>{row.source === 'manual' ? 'zugeordnet' : 'automatisch'}</span>
              </p>
            </div>
            {/* Removes the link only; the mail stays in the mailbox */}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zuordnung entfernen"
              title="Zuordnung entfernen"
              onClick={() => {
                setRemoved((current) => new Set(current).add(row.id))
                dismiss.mutate({ id: row.id })
              }}
            >
              <Unlink />
            </Button>
          </li>
        ))}
      </ul>
      {links.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={links.isFetchingNextPage}
          onClick={() => void links.fetchNextPage()}
        >
          {links.isFetchingNextPage ? 'Wird geladen…' : 'Mehr laden'}
        </Button>
      )}
    </div>
  )
}
