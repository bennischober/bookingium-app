import { Lightbulb, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dismissed, isTipShown, setTipState, TIPS, type TipId } from '@/lib/tips'
import { useTipState } from '@/hooks/useTipState'

/**
 * #253: a short tip about the feature next to it. Clicked away once, it stays away on this
 * computer; Einstellungen › Allgemein brings all tips back or turns them off.
 */
export function Tip({ id, className }: { id: TipId; className?: string }) {
  const state = useTipState()
  if (!isTipShown(state, id)) return null
  const tip = TIPS[id]
  return (
    <aside
      aria-label={`Tipp: ${tip.title}`}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100',
        className
      )}
    >
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{tip.title}</p>
        <p className="text-amber-900/80 dark:text-amber-100/80">{tip.text}</p>
      </div>
      <button
        type="button"
        className="-mr-1 rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
        aria-label="Tipp ausblenden"
        title="Tipp ausblenden"
        onClick={() => setTipState((current) => dismissed(current, id))}
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  )
}
