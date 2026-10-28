import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import {
  ACTION_LABELS,
  ATTENTION_LABELS,
  type OpAction,
  type OpEntry,
  attentionHint,
  opAge,
  opBadge,
  opKindLabel,
  opWhere
} from './opJournal'

/**
 * I3: the badge in the mail header and the panel behind it. Shows the writes that need the
 * user - unclear sends, rejected or failed changes, stuck ones - with what can be done about
 * each. The page fetches the ops and runs the actions; this only shows them.
 */
export function OpJournalPanel({
  entries,
  now,
  busyId,
  onAction
}: {
  entries: OpEntry[]
  now: number
  /** the op whose action is running; its buttons are disabled meanwhile */
  busyId: string | null
  onAction: (entry: OpEntry, action: OpAction) => void
}) {
  const [open, setOpen] = useState(false)
  const badge = opBadge(entries)

  return (
    <>
      {badge.count > 0 && (
        <Button
          size="sm"
          variant={badge.urgent ? 'destructive' : 'outline'}
          onClick={() => setOpen(true)}
          data-testid="mail-op-badge"
          title="Änderungen, die nicht beim Server angekommen sind"
        >
          <AlertTriangle />
          {badge.count === 1 ? '1 offene Änderung' : `${badge.count} offene Änderungen`}
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="w-full overflow-y-auto sm:w-[480px] sm:max-w-[480px]"
          data-testid="mail-op-panel"
        >
          <SheetHeader>
            <SheetTitle>Offene Änderungen</SheetTitle>
            <SheetDescription>
              Was Bookingium noch nicht beim Server erledigen konnte. Alles andere ist übertragen.
            </SheetDescription>
          </SheetHeader>
          {entries.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nichts offen.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {entries.map((entry) => (
                <OpRow
                  key={entry.op.id}
                  entry={entry}
                  now={now}
                  busy={busyId === entry.op.id}
                  onAction={onAction}
                />
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function OpRow({
  entry,
  now,
  busy,
  onAction
}: {
  entry: OpEntry
  now: number
  busy: boolean
  onAction: (entry: OpEntry, action: OpAction) => void
}) {
  const { op, attention, actions } = entry
  const urgent = attention === 'unclear' || attention === 'rejected'
  const where = opWhere(op)
  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3 text-sm',
        urgent && 'border-destructive/40 bg-destructive/5'
      )}
      data-testid="mail-op-entry"
      data-op-id={op.id}
      data-attention={attention}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{opKindLabel(op.kind)}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{opAge(op.updatedAt, now)}</span>
      </div>
      <div className={cn('text-xs font-medium', urgent ? 'text-destructive' : 'text-foreground')}>
        {ATTENTION_LABELS[attention]}
      </div>
      {where && <div className="truncate text-xs text-muted-foreground">{where}</div>}
      <p className="text-xs text-muted-foreground">{attentionHint(op, attention)}</p>
      {op.error && (
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={op.error}>
          {op.error}
        </p>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === 'discard' ? 'ghost' : 'outline'}
              disabled={busy}
              onClick={() => onAction(entry, action)}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
          {busy && <Spinner className="size-3.5" />}
        </div>
      )}
    </li>
  )
}
