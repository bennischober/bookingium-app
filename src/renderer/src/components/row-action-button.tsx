import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Icon button for a table/list row (open, edit, delete, …), so every grid
 * looks and behaves the same:
 * - neutral icon; a destructive action turns red only on hover, the
 *   confirmation dialog does the warning
 * - the label is the tooltip and the accessible name
 * - clicks don't bubble to the row (rows may navigate on click)
 */
export function RowActionButton({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  disabled = false,
  disabledReason
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  /** Tooltip while disabled (a disabled button shows none itself) */
  disabledReason?: string
}) {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      title={disabled ? undefined : label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'text-muted-foreground hover:text-foreground',
        destructive && 'hover:bg-destructive/10 hover:text-destructive'
      )}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )

  // Disabled buttons get no pointer events, so the hint sits on a wrapper
  return disabled && disabledReason ? <span title={disabledReason}>{button}</span> : button
}

/** Row action group: right-aligned, evenly spaced */
export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-1">{children}</div>
}
