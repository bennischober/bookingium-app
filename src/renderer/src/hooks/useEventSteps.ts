import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import type { EventStep } from '../../../main/api/schemas/event_step.schema'
import { t } from '../../../main/i18n/translate'

/** The ticked steps of an event ("extern erledigt") and a way to tick or untick one */
export function useEventSteps(eventId: number) {
  const utils = trpcReact.useUtils()
  const steps = trpcReact.eventStep.list.useQuery({ eventId })
  const mutation = trpcReact.eventStep.set.useMutation({
    // The tick flips at once; a failed save puts it back
    onMutate: async (input) => {
      await utils.eventStep.list.cancel({ eventId })
      const previous = utils.eventStep.list.getData({ eventId })
      // Database timestamp format (UTC, no zone), like the row the save returns
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
      utils.eventStep.list.setData({ eventId }, (rows = []) =>
        input.done
          ? rows.some((row) => row.step === input.step)
            ? rows
            : [...rows, { step: input.step, doneAt: now }]
          : rows.filter((row) => row.step !== input.step)
      )
      return { previous }
    },
    onSuccess: (saved) => {
      utils.eventStep.list.setData({ eventId }, saved)
      // A ticked step is no open point any more (dashboard and event page)
      void utils.dashboard.openItems.invalidate()
    },
    onError: (error, _input, context) => {
      utils.eventStep.list.setData({ eventId }, context?.previous)
      toast.error(t('Konnte nicht gespeichert werden'), { description: error.message })
    }
  })
  const done = new Map((steps.data ?? []).map((row) => [row.step, row.doneAt]))
  return {
    done,
    isLoading: steps.isLoading,
    isSaving: mutation.isPending,
    set: (step: EventStep, value: boolean) => mutation.mutate({ eventId, step, done: value })
  }
}
