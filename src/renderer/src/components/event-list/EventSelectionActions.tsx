import { Archive } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { STATUS_LABELS } from '@/components/event-hub/constants'
import { DealMemoStatus } from '../../../../main/api/schemas/deal_memo.schema'
import { eventCount } from './eventCount'

/**
 * #200: what can be done with the events picked in the list - one status for all, or archive
 * them. Each asks once, naming the count, and its toast can undo it.
 */
export function EventSelectionActions({
  ids,
  onDone
}: {
  ids: readonly number[]
  /** Called after an action ran (the page clears the selection) */
  onDone: () => void
}) {
  const utils = trpcReact.useUtils()
  const refresh = () => {
    void utils.dealMemo.getAllPaginated.invalidate()
    void utils.dealMemo.listArchived.invalidate()
  }
  const setStatuses = trpcReact.dealMemo.setStatuses.useMutation({ onSettled: refresh })
  const archiveMany = trpcReact.dealMemo.archiveMany.useMutation({ onSettled: refresh })
  const restoreMany = trpcReact.dealMemo.restoreMany.useMutation({ onSettled: refresh })
  const busy = setStatuses.isPending || archiveMany.isPending

  const setStatus = async (status: DealMemoStatus) => {
    const label = STATUS_LABELS[status]
    if (
      !(await confirmAction({
        title: `${eventCount(ids.length)} auf „${label}“ setzen?`,
        description: 'Der Status jedes ausgewählten Events wird geändert.',
        confirmLabel: 'Status setzen'
      }))
    ) {
      return
    }
    try {
      const before = await setStatuses.mutateAsync({
        changes: ids.map((id) => ({ id, status }))
      })
      onDone()
      const changed = before.changes.length
      toast.success(
        changed === 0
          ? `Alle hatten schon „${label}“`
          : `${eventCount(changed)} auf „${label}“ gesetzt`,
        changed === 0
          ? undefined
          : {
              action: {
                label: 'Rückgängig',
                onClick: () =>
                  setStatuses.mutate(before, {
                    onError: (error) =>
                      toast.error('Rückgängig fehlgeschlagen', { description: error.message })
                  })
              }
            }
      )
    } catch (error) {
      toast.error('Status konnte nicht gesetzt werden', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const archive = async () => {
    if (
      !(await confirmAction({
        title: `${eventCount(ids.length)} archivieren?`,
        description:
          'Die Events verschwinden aus den Listen und dem Kalender. Rechnungen, Dokumente und Wiedervorlagen bleiben erhalten, und sie lassen sich jederzeit wiederherstellen.',
        confirmLabel: 'Archivieren'
      }))
    ) {
      return
    }
    try {
      const archived = await archiveMany.mutateAsync({ ids: [...ids] })
      onDone()
      toast.success(`${eventCount(archived.ids.length)} archiviert`, {
        action: {
          label: 'Rückgängig',
          onClick: () =>
            archived.ids.length > 0 &&
            restoreMany.mutate(
              { ids: archived.ids },
              {
                onError: (error) =>
                  toast.error('Rückgängig fehlgeschlagen', { description: error.message })
              }
            )
        }
      })
    } catch (error) {
      toast.error('Events konnten nicht archiviert werden', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return (
    <>
      {/* value stays empty: picking a status is the action, not a filter */}
      <Select value="" onValueChange={(value) => void setStatus(value as DealMemoStatus)}>
        <SelectTrigger className="h-8 w-44" aria-label="Status setzen" disabled={busy}>
          <SelectValue placeholder="Status setzen…" />
        </SelectTrigger>
        <SelectContent>
          {DealMemoStatus.options.map((status) => (
            <SelectItem key={status} value={status}>
              {STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={() => void archive()} disabled={busy}>
        <Archive className="h-4 w-4" /> Archivieren
      </Button>
    </>
  )
}
