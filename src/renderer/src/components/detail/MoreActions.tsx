import { useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export type MoreAction = {
  label: string
  icon: ReactNode
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  title?: string
}

/**
 * The rarely used actions of a page header (Duplizieren, Zusammenführen, Löschen) behind one
 * "…" button, so the header keeps only what is used every day. The menu closes before the
 * action runs: a dialog the action opens belongs to the page, not to the menu.
 */
export function MoreActions({ actions }: { actions: MoreAction[] }) {
  const [open, setOpen] = useState(false)
  if (actions.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="px-2" aria-label="Weitere Aktionen">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <div role="menu" className="flex flex-col">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              title={action.title}
              disabled={action.disabled}
              className={cn(
                'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50',
                action.destructive && 'text-destructive hover:bg-destructive/10'
              )}
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
