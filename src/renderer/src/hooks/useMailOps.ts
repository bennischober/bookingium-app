import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { confirmAction } from '@/lib/confirm'
import { VISIBLE_OPS } from '@/components/mail/opLabel'
import { refreshBatcher, refreshPlan } from '@/components/mail/mailRefresh'
import {
  type OpAction,
  type OpEntry,
  actionResult,
  discardConfirm,
  opEntries
} from '@/components/mail/opJournal'

/** R4: the mail page's open ops and their actions, the running op and the refresh batcher */
export function useMailOps({
  accountId,
  ready,
  canWrite,
  refreshLists,
  failed
}: {
  accountId: string
  ready: boolean
  canWrite: boolean
  refreshLists: () => void
  failed: (title: string) => (error: unknown) => void
}) {
  const queryClient = useQueryClient()
  // H2: a write op the user started and that is still running; the sync bar shows it.
  // Autosave and flag ops are excluded (see opLabel.ts) so the bar stays quiet.
  const [runningOp, setRunningOp] = useState<string | null>(null)

  // I3: writes that need the user (unclear sends, rejected or failed changes, stuck ones).
  // Every op-event refreshes it; the interval catches an op turning stuck by just waiting.
  const openOps = useQuery({
    queryKey: ['mail', accountId, 'open-ops'],
    queryFn: () => mailApi.listOpenOps(accountId),
    enabled: ready && canWrite,
    refetchInterval: 30_000
  })
  const opNow = openOps.dataUpdatedAt || Date.now()
  const opList = useMemo(() => opEntries(openOps.data ?? [], opNow), [openOps.data, opNow])
  const [busyOpId, setBusyOpId] = useState<string | null>(null)

  // Refresh folders, lists and search when the sync stored something new or a change
  // was made (also in a mail window); batched, the initial download reports every folder.
  // I18: another account's events mark that account stale instead of being dropped.
  const [refresher] = useState(() =>
    refreshBatcher((key) => void queryClient.invalidateQueries({ queryKey: [...key] }))
  )
  useEffect(() => () => refresher.dispose(), [refresher])
  trpcReact.mail.events.useSubscription(undefined, {
    enabled: ready,
    onData: (event) => {
      // H2: show a write op while it runs, but only one the user started. Autosave
      // (draft_save) and flag changes run in the background every few seconds; showing
      // those would make the bar flicker nonstop, which is the opposite of quiet.
      if (
        event.type === 'op-event' &&
        event.accountId === accountId &&
        VISIBLE_OPS.has(event.kind)
      ) {
        setRunningOp(event.outcome === 'running' ? event.kind : null)
      }
      const plan = refreshPlan(event, accountId)
      if (plan) refresher.add(plan)
    }
  })

  // I3: an action from the op panel. Discarding asks first; the core resyncs the op's folders,
  // so a hidden mail or a local flag gives way to what the server has.
  const runOpAction = async (entry: OpEntry, action: OpAction) => {
    if (action === 'discard') {
      if (!(await confirmAction({ ...discardConfirm(entry), destructive: true }))) return
    }
    setBusyOpId(entry.op.id)
    try {
      if (action === 'discard') {
        await mailApi.cancelOp(entry.op.id, accountId)
        toast.success('Verworfen')
      } else {
        const result =
          action === 'resolve'
            ? await mailApi.resolveOp(entry.op.id, accountId)
            : await mailApi.retryOp(entry.op.id, accountId)
        const { ok, text } = actionResult(action, result.outcome)
        if (ok) toast.success(text)
        else toast.error(text)
      }
    } catch (error) {
      failed('Aktion fehlgeschlagen')(error)
    } finally {
      setBusyOpId(null)
      void openOps.refetch()
      refreshLists()
    }
  }

  return { runningOp, opList, opNow, busyOpId, runOpAction }
}
