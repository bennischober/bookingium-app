import { CircleAlert } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { OpenItemsList } from './OpenItemsList'
import { t } from '../../../../main/i18n/translate'

/**
 * #201: the event page's open points, above the tabs; nothing when there are none. Its due
 * follow-ups are already shown by RecordFollowUps right above.
 */
export function EventOpenItems({ eventId }: { eventId: number }) {
  const items = trpcReact.dashboard.openItems.useQuery({ eventId }, { staleTime: 0 })
  const open = items.data ?? []
  if (open.length === 0) return null
  return (
    <section
      aria-label={t('Offene Punkte des Events')}
      className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30"
    >
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <CircleAlert className="h-4 w-4 text-amber-600" aria-hidden />
        {t('Offene Punkte')}
      </p>
      <OpenItemsList items={open} />
    </section>
  )
}
