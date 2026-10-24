import { useState } from 'react'
import { Mail, Paperclip, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
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
  const links = trpcReact.mailLink.listByEntity.useInfiniteQuery(
    { entityType, entityId, limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined }
  )
  const dismiss = trpcReact.mailLink.dismiss.useMutation({
    onSuccess: () => void links.refetch(),
    onError: (error) =>
      toast.error('Zuordnung konnte nicht entfernt werden', {
        description: error.message
      })
  })

  if (links.isLoading) return <Spinner className="m-4" />
  const rows = (links.data?.pages ?? [])
    .flatMap((page) => page.rows)
    .filter((row) => !removed.has(row.id))
  if (rows.length === 0) {
    return <p className="m-4 text-sm text-muted-foreground">Keine E-Mails zugeordnet.</p>
  }

  const open = (row: MailLinkRow) => {
    if (row.storeId !== null && row.accountId) {
      void window.api.openMailWindow(row.accountId, row.storeId)
    }
  }

  return (
    <div className="space-y-2 p-4">
      <ul className="divide-y rounded-md border" aria-label="E-Mails">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 px-3 py-2">
            <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="block max-w-full truncate text-left text-sm font-medium hover:underline disabled:no-underline"
                /* A mail that is no longer in the store cannot be opened */
                disabled={row.storeId === null}
                onClick={() => open(row)}
              >
                {row.subject ?? 'Nicht mehr im Postfach'}
              </button>
              <p className="truncate text-xs text-muted-foreground">
                {row.fromName || row.fromEmail || '—'}
                {row.date ? ` · ${formatListDate(row.date)}` : ''}
                <span className="ml-2">
                  {row.source === 'manual' ? 'zugeordnet' : 'automatisch'}
                </span>
              </p>
            </div>
            {row.hasAttachments && (
              <Paperclip
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="Mit Anhang"
              />
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zuordnung entfernen"
              onClick={() => {
                setRemoved((current) => new Set(current).add(row.id))
                dismiss.mutate({ id: row.id })
              }}
            >
              <Trash2 />
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
