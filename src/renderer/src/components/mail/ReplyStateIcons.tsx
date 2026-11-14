import { Forward, Reply } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * #163: whether a mail was answered (\Answered) or forwarded ($Forwarded). The lists
 * show the icons alone; the reading pane adds the words.
 */
export function ReplyStateIcons({
  answered,
  forwarded,
  withLabel = false,
  className
}: {
  answered: boolean
  forwarded: boolean
  withLabel?: boolean
  className?: string
}) {
  if (!answered && !forwarded) return null
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 text-muted-foreground', className)}
    >
      {answered && (
        <span className="inline-flex items-center gap-1" title="Beantwortet">
          <Reply className="size-3.5" aria-label={withLabel ? undefined : 'Beantwortet'} />
          {withLabel && <span className="text-xs">Beantwortet</span>}
        </span>
      )}
      {forwarded && (
        <span className="inline-flex items-center gap-1" title="Weitergeleitet">
          <Forward className="size-3.5" aria-label={withLabel ? undefined : 'Weitergeleitet'} />
          {withLabel && <span className="text-xs">Weitergeleitet</span>}
        </span>
      )}
    </span>
  )
}
